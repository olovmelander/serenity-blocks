/**
 * Neon District — bake the shopfront atlas and the campaign (billboard) atlas.
 *
 * Shopfronts: the district's painted shopfronts (scripts/neon-district/source-art/), packed with
 * edge-extended gutters into one WebP atlas.
 *
 * Campaigns: everything the district advertises, packed the same way into a 4096 × 3584 atlas —
 * the user adverts from source-art/, and the generated campaigns painted here on a 2D canvas: the
 * eight district brands (one 16:9 billboard and two 2:3 posters in different designs each), Hale's
 * calm spots (with an empty ring the theme's shader breathes in) and the Serenity Transit travel
 * posters — 34 worlds in seven poster designs, coloured from the game's own renders of them (docs/
 * captures), and the three modes from the menu's key art (public/assets/menu-art/).
 *
 * Writes the cell table the theme reads (src/themes/neon-district/neon-district-atlas.js): UV rect,
 * aspect, the colour each piece throws on the street (a luminance-weighted mean, scene-linear,
 * peak-normalised) and, for the campaign atlas, what each cell is (id, family, brand, shape, motion,
 * ring).
 *
 *   node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs [--out=<dir>]
 *
 * (`--out` writes everything into <dir> instead of the repository, for trying a change.)
 *
 * Electron is only used for its canvas (decode, draw, scale, encode); hardware acceleration is off,
 * so nothing touches the GPU. Fonts are the game's own (public/fonts/, all OFL). The bake is
 * deterministic: no clock, and every random choice comes from a seeded generator.
 */
/* eslint-disable import/no-extraneous-dependencies, no-restricted-syntax, no-await-in-loop */
import electron from 'electron';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const { app, BrowserWindow } = electron;
app.disableHardwareAcceleration();

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'scripts', 'neon-district', 'source-art');
/**
 * `--out=<dir>` writes the atlases and the cell table into <dir> instead of the repository (for
 * trying a change without touching the shipped files).
 */
const OUT_ARG = process.argv.find((a) => a.startsWith('--out='));
const OUT_OVERRIDE = OUT_ARG ? path.resolve(OUT_ARG.slice('--out='.length)) : null;
const OUT_DIR = OUT_OVERRIDE || path.join(ROOT, 'public', 'textures', 'neon-district');
const TABLE = OUT_OVERRIDE
    ? path.join(OUT_OVERRIDE, 'neon-district-atlas.js')
    : path.join(ROOT, 'src', 'themes', 'neon-district', 'neon-district-atlas.js');
const GUTTER = 6;

const pad = (n) => String(n).padStart(2, '0');
const fileUrl = (...parts) => pathToFileURL(path.join(...parts)).href;

/**
 * Shopfronts: seven 1.27:1 pieces, then nine wide cells (the 2.45:1 arcade is letterboxed).
 * storefront_02 is not used: its sign shows another game's characters.
 */
const SHOPFRONTS = {
    file: 'shopfronts',
    width: 2560,
    height: 2556,
    cells: [
        ...[3, 4, 5, 6, 7, 8, 9].map((n, i) => ({
            src: `storefront_${pad(n)}.jpg`, x: (i % 4) * 640, y: Math.floor(i / 4) * 504, w: 640, h: 504,
        })),
        ...[11, 12, 13, 14, 15, 16, 17, 18, 10].map((n, i) => ({
            src: `storefront_${pad(n)}.jpg`, x: (i % 3) * 853, y: 1008 + Math.floor(i / 3) * 516, w: 853, h: 516,
        })),
    ].map((c) => ({ ...c, url: fileUrl(SOURCE, c.src) })),
};

/** Content size of each campaign cell shape (the gutter is added around it). */
const SHAPES = {
    wide: { w: 592, h: 333 },
    portrait: { w: 328, h: 492 },
    square: { w: 384, h: 384 },
};

/** User adverts: four wide screens, then six square ones (ads_large_18 is out: a film company's mark). */
const USER_ADS = [
    ...[8, 9, 10, 11].map((n) => ({ n, shape: 'wide' })),
    ...[7, 12, 13, 15, 16, 17].map((n) => ({ n, shape: 'square' })),
];

/** Hale's empty ring: [cx, cy, r] in cell fractions (v down from the top, r a fraction of the height). */
const HALE_RING = { wide: [0.735, 0.5, 0.38], portrait: [0.5, 0.465, 0.205] };

/**
 * Serenity Transit world posters, in atlas order. `image` is the game's own render of the world
 * (docs/ captures); `region` the part of it a poster may show ([x, y, w, h] in source pixels, clear
 * of the board, its panels and any UI; left out = the whole frame), `focus` the point the poster
 * frames on ([x, y] in source pixels) and `zoom` (default 1) how much closer than the whole region
 * it may crop. The colours of each poster are sampled from its region. Ids are theme ids from the
 * registry and names its display names; straplines come from each world's own design record
 * (docs/*_OVERHAUL_*.md).
 *
 * `layout` is the poster's design (POSTER_DESIGNS in the page): seven designs, as if by seven
 * designers on one line, used about equally and never twice in a row (checked below).
 */
const TRANSIT_LAYOUTS = ['vintage', 'side', 'swiss', 'deco', 'duotone', 'ticket', 'porthole'];
const TRANSIT_WORLDS = [
    {
        id: 'koi-pond',
        name: 'KOI POND',
        line: 'MOONWAKE NIGHTS',
        layout: 'porthole',
        image: 'docs/koi-pond-overhaul/koi.jpg',
        focus: [800, 330],
    },
    {
        id: 'sakura-twilight',
        name: 'SAKURA TWILIGHT',
        line: 'THE MOONLIT GARDEN',
        layout: 'deco',
        image: 'docs/sakura-twilight-overhaul/idle.jpg',
        focus: [560, 300],
    },
    {
        id: 'crystal-cave',
        name: 'CRYSTAL CAVE',
        line: 'THE RESONANT HALL',
        layout: 'side',
        image: 'docs/crystal-cave-overhaul/idle.webp',
        focus: [420, 330],
    },
    {
        id: 'golden-forest',
        name: 'GOLDEN FOREST',
        line: 'THE LAKE AT THE GOLDEN HOUR',
        layout: 'vintage',
        image: 'docs/golden-forest-lake/idle.webp',
        focus: [420, 330],
    },
    {
        id: 'summer',
        name: 'MIDSOMMAR',
        line: 'THE SUN THAT WILL NOT SET',
        layout: 'swiss',
        image: 'docs/summer-midsommar/idle.webp',
        focus: [480, 280],
    },
    {
        id: 'ocean',
        name: 'OCEAN',
        line: 'THE EDGE OF THE BLUE',
        layout: 'duotone',
        image: 'docs/ocean-overhaul/01-idle.webp',
        focus: [640, 344],
    },
    {
        id: 'winter',
        name: 'WINTER',
        line: 'FOLLOW THE FOX FIRES',
        layout: 'ticket',
        image: 'docs/winter-fox-fires/rest.webp',
        region: [0, 0, 490, 682],
        focus: [300, 210],
    },
    {
        id: 'stillwater',
        name: 'STILLWATER',
        line: 'THE TARN AT NIGHT',
        layout: 'vintage',
        image: 'docs/stillwater-overhaul/desktop-rest.jpg',
        focus: [420, 380],
    },
    {
        id: 'aether-tides',
        name: 'AETHER TIDES',
        line: 'THE LIVING NEBULA',
        layout: 'duotone',
        image: 'docs/aether-tides-captures/desktop-rest.webp',
        focus: [360, 340],
    },
    {
        id: 'astral-weave',
        name: 'ASTRAL WEAVE',
        line: 'THE LOOM OF HEAVEN',
        layout: 'porthole',
        image: 'docs/astral-weave-captures/desktop-idle.webp',
        region: [0, 0, 620, 787],
        focus: [330, 400],
    },
    {
        id: 'cinder-drift',
        name: 'CINDER DRIFT',
        line: 'THE DRIFTING CRUST',
        layout: 'side',
        image: 'docs/cinder-drift-captures/desktop-rest.webp',
        focus: [100, 400],
        zoom: 1.35,
    },
    {
        id: 'galaxy',
        name: 'GALAXY',
        line: 'THE GRAND SPIRAL',
        layout: 'swiss',
        image: 'docs/galaxy-captures/desktop-rest.jpg',
        focus: [390, 400],
    },
    {
        id: 'himalayan-peak',
        name: 'HIMALAYAN PEAK',
        line: 'DAWN ON A HIGH PASS',
        layout: 'ticket',
        image: 'docs/himalayan-peak-captures/rest.webp',
        focus: [400, 330],
    },
    {
        id: 'lunara',
        name: 'LUNARA',
        line: 'THE VALLEY OF TWIN MOONS',
        layout: 'deco',
        image: 'docs/lunara-captures/desktop-rest.webp',
        focus: [330, 330],
    },
    {
        id: 'bioluminescence',
        name: 'BIOLUMINESCENCE',
        line: 'THE LIVING GROTTO',
        layout: 'vintage',
        image: 'docs/bioluminescence-overhaul/desktop-rest.webp',
        focus: [420, 340],
    },
    {
        id: 'geode',
        name: 'GEODE',
        line: 'THE HEART OF THE GEODE',
        layout: 'porthole',
        image: 'docs/geode-captures/desktop-rest.webp',
        focus: [800, 400],
    },
    {
        id: 'rainbark',
        name: 'RAINBARK',
        line: 'THE PAINTED GIANTS',
        layout: 'side',
        image: 'docs/rainbark-captures/rest-L4-t55-webgpu.webp',
        focus: [360, 540],
    },
    {
        id: 'stellar-velocity',
        name: 'STELLAR VELOCITY',
        line: 'THE STARBOW RUN',
        layout: 'duotone',
        image: 'docs/stellar-velocity-captures/desktop-rest.jpg',
        region: [0, 0, 600, 852],
        focus: [360, 400],
    },
    {
        id: 'halcyon-apex',
        name: 'HALCYON APEX',
        line: 'THE SANCTUARY OF FIRST LIGHT',
        layout: 'deco',
        image: 'docs/halcyon-apex-overhaul/rest.jpg',
        focus: [330, 360],
    },
    {
        id: 'chromatic-impasto',
        name: 'CHROMATIC IMPASTO',
        line: 'PAINTED IN THICK OIL',
        layout: 'swiss',
        image: 'docs/chromatic-impasto-overhaul/rest.webp',
        focus: [790, 400],
    },
    {
        id: 'fluid-dreams',
        name: 'FLUID DREAMS',
        line: 'THE DREAMING SEA',
        layout: 'ticket',
        image: 'docs/fluid-dreams-overhaul/desktop-rest.webp',
        focus: [700, 400],
    },
    {
        id: 'murmuration',
        name: 'MURMURATION',
        line: 'A SWARM OF LIGHT IN THE NIGHT',
        layout: 'porthole',
        image: 'docs/murmuration-captures/rest.webp',
        focus: [650, 340],
    },
    {
        id: 'voltage-storm',
        name: 'VOLTAGE STORM',
        line: 'THE COLLECTOR FIELD',
        layout: 'side',
        image: 'docs/voltage-storm-captures/desktop-rest.jpg',
        focus: [220, 400],
    },
    {
        id: 'void-ember',
        name: 'VOID EMBER',
        line: 'THE LAST EMBER',
        layout: 'duotone',
        image: 'docs/void-ember-captures/desktop-rest.jpg',
        region: [0, 0, 535, 746],
        focus: [260, 380],
    },
    {
        id: 'vesper-chrysalis',
        name: 'VESPER CHRYSALIS',
        line: 'THE HATCHING AT DUSK',
        layout: 'vintage',
        image: 'docs/vesper-chrysalis-overhaul/desktop-rest.jpg',
        focus: [520, 360],
    },
    {
        id: 'aurora',
        name: 'AURORA',
        line: 'A CLEAR ARCTIC NIGHT',
        layout: 'deco',
        image: 'docs/aurora-overhaul/idle.jpg',
        focus: [720, 330],
    },
    {
        id: 'stellar-drift',
        name: 'STELLAR DRIFT',
        line: 'THE RINGED GIANT',
        layout: 'swiss',
        image: 'docs/stellar-drift-captures/desktop-rest.jpg',
        region: [0, 0, 530, 746],
        focus: [260, 380],
    },
    {
        id: 'rainbow-terraces',
        name: 'RAINBOW TERRACES',
        line: 'THE HIGH COUNTRY',
        layout: 'ticket',
        image: 'docs/rainbow-terraces-overhaul/01-idle.webp',
        focus: [640, 380],
    },
    {
        id: 'supernova',
        name: 'SUPERNOVA',
        line: 'A MASSIVE STAR BURNS',
        layout: 'porthole',
        image: 'docs/supernova-captures/desktop-rest.jpg',
        region: [0, 0, 490, 720],
        focus: [240, 350],
    },
    {
        id: 'ice-temple',
        name: 'ICE TEMPLE',
        line: 'THE SINGING NAVE',
        layout: 'side',
        image: 'docs/ice-temple-overhaul/rest.jpg',
        focus: [600, 380],
    },
    {
        id: 'waves',
        name: 'WAVES',
        line: 'THE GREEN ROOM',
        layout: 'duotone',
        image: 'docs/waves-overhaul/idle-no-board.jpg',
        focus: [430, 330],
    },
    {
        id: 'forest',
        name: 'FOREST',
        line: 'THE FIREFLY NIGHT',
        layout: 'vintage',
        image: 'docs/forest-firefly-night/idle.webp',
        focus: [460, 420],
    },
    {
        id: 'moonlit-greenhouse',
        name: 'MOONLIT GREENHOUSE',
        line: 'THE NIGHT GARDEN UNDER GLASS',
        layout: 'deco',
        image: 'docs/moonlit-greenhouse-overhaul/rest.webp',
        focus: [640, 380],
    },
    {
        id: 'black-hole',
        name: 'BLACK HOLE',
        line: 'WHERE LIGHT BENDS',
        layout: 'swiss',
        image: 'docs/black-hole-overhaul/idle.jpg',
        region: [0, 0, 620, 852],
        focus: [320, 420],
    },
];

/** Every layout used about equally, and never on two posters in a row. */
function checkLayouts(worlds) {
    const counts = Object.fromEntries(TRANSIT_LAYOUTS.map((l) => [l, 0]));
    worlds.forEach((w, i) => {
        if (!(w.layout in counts)) throw new Error(`unknown transit layout ${w.layout} (${w.id})`);
        if (i && worlds[i - 1].layout === w.layout) {
            throw new Error(`transit layout ${w.layout} twice in a row at ${w.id}`);
        }
        counts[w.layout] += 1;
    });
    const n = Object.values(counts);
    if (Math.max(...n) - Math.min(...n) > 1) throw new Error(`transit layouts unbalanced: ${JSON.stringify(counts)}`);
}

/**
 * Serenity Transit mode posters: the menu's key art for the mode (cropped clear of the board and
 * its panels) and lines taken from the mode's own menu copy. `stops` = stop dots on the route;
 * `layout` is one of three wide designs, a different one per mode.
 */
const TRANSIT_MODES = [
    {
        id: 'infinity',
        name: 'INFINITY',
        line: 'HOW HIGH WILL YOU GO?',
        sub: 'ONE THOUSAND ROWS TALL',
        accent: 0xff8fdc,
        stops: 3,
        layout: 'classic',
        images: [{ image: 'public/assets/menu-art/infinity.webp', region: [70, 0, 730, 640] }],
    },
    {
        id: 'stillfall',
        name: 'STILLFALL',
        line: 'GRAVITY WAITS WHILE YOU CHOOSE',
        sub: 'A FEW PIECES AND ONE GOAL',
        accent: 0xffac88,
        stops: 6,
        layout: 'marquee',
        images: [{ image: 'public/assets/menu-art/stillfall.webp', region: [60, 0, 800, 640], focus: [400, 300] }],
    },
    {
        id: 'odyssey',
        name: 'ODYSSEY',
        line: 'FROM THE EARTH\'S CORE',
        sub: 'TO THE EDGE OF A BLACK HOLE',
        accent: 0xffa04e,
        stops: 3,
        layout: 'journey',
        images: [
            { image: 'public/assets/menu-art/odyssey-1.webp', region: [300, 40, 640, 594] },
            { image: 'public/assets/menu-art/odyssey-7.webp', region: [600, 0, 430, 600] },
        ],
    },
];

const withUrls = (images) => images.map((im) => ({
    url: fileUrl(ROOT, im.image), region: im.region || null, focus: im.focus || null, zoom: im.zoom || 1,
}));

/** Every campaign cell, in table order: user adverts, brands, Hale, transit. */
function campaignCells({ BRANDS, HALE, TRANSIT }) {
    const cells = [];
    for (const { n, shape } of USER_ADS) {
        const src = `ads_large_${pad(n)}.jpg`;
        cells.push({
            id: `user-ads_large_${pad(n)}`,
            family: 'user',
            brand: null,
            shape,
            motion: 'none',
            ring: null,
            src,
            url: fileUrl(SOURCE, src),
        });
    }
    // Each brand: its billboard, its poster, and a second poster in another design of the same
    // campaign (same colours, mark, name and slogan).
    for (const brand of BRANDS) {
        for (const [shape, variant] of [['wide', 1], ['portrait', 1], ['portrait', 2]]) {
            cells.push({
                id: `brand-${brand.id}-${shape}${variant > 1 ? `-${variant}` : ''}`,
                family: 'brand',
                brand: brand.id,
                shape,
                motion: 'none',
                ring: null,
                src: null,
                paint: { kind: 'brand', brand, variant },
            });
        }
    }
    for (const shape of ['wide', 'portrait']) {
        cells.push({
            id: `hale-${shape}`,
            family: 'hale',
            brand: 'hale',
            shape,
            motion: 'breathe',
            ring: HALE_RING[shape],
            src: null,
            paint: { kind: 'hale', brand: HALE, ring: HALE_RING[shape] },
        });
    }
    checkLayouts(TRANSIT_WORLDS);
    TRANSIT_WORLDS.forEach((w, i) => {
        cells.push({
            id: `transit-${w.id}`,
            family: 'transit',
            brand: 'transit',
            shape: 'portrait',
            motion: 'pan',
            ring: null,
            src: null,
            paint: {
                kind: 'world', brand: TRANSIT, poster: { ...w, n: i + 1 }, images: withUrls([w]),
            },
        });
    });
    for (const mode of TRANSIT_MODES) {
        cells.push({
            id: `transit-mode-${mode.id}`,
            family: 'transit',
            brand: 'transit',
            shape: 'wide',
            motion: 'pan',
            ring: null,
            src: null,
            paint: {
                kind: 'mode', brand: TRANSIT, poster: mode, images: withUrls(mode.images),
            },
        });
    }
    return cells;
}

/**
 * Simple shelf packing: portraits, then squares, then wides, left to right; a shelf is as tall as
 * its tallest cell. Each cell keeps a GUTTER on every side for the edge extension.
 */
function packShelves(cells, width, height) {
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const shape of ['portrait', 'square', 'wide']) {
        for (const cell of cells.filter((c) => c.shape === shape)) {
            const w = SHAPES[shape].w + GUTTER * 2;
            const h = SHAPES[shape].h + GUTTER * 2;
            if (x + w > width) {
                y += shelf;
                x = 0;
                shelf = 0;
            }
            shelf = Math.max(shelf, h);
            if (y + h > height) throw new Error(`campaign atlas overflow at ${cell.id}`);
            Object.assign(cell, {
                x, y, w, h,
            });
            x += w;
        }
    }
    return cells;
}

const CAMPAIGN_ATLAS = { file: 'billboards', width: 4096, height: 3584 };

/** The game's fonts (all OFL), handed to the page as bytes. */
const FONTS = [
    ['Orbitron', '400', 'orbitron/orbitron-latin-400-normal.woff2'],
    ['Orbitron', '700', 'orbitron/orbitron-latin-700-normal.woff2'],
    ['Orbitron', '900', 'orbitron/orbitron-latin-900-normal.woff2'],
    ['Unbounded', '200 900', 'unbounded/unbounded-latin-wght-normal.woff2'],
    ['Manrope', '200 800', 'manrope/manrope-latin-wght-normal.woff2'],
    ['Space Mono', '400', 'space-mono/space-mono-latin-400-normal.woff2'],
    ['Space Mono', '700', 'space-mono/space-mono-latin-700-normal.woff2'],
];

/** Runs in the page: loads the fonts. */
async function installFontsInPage(fonts) {
    for (const f of fonts) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        const face = new FontFace(f.family, bytes.buffer, { weight: f.weight });
        await face.load();
        document.fonts.add(face);
    }
    await document.fonts.ready;
    return document.fonts.size;
}

/**
 * Runs in the page: installs window.__campaignArt, the painter of every generated campaign cell.
 * Self-contained (it is sent to the page as source). Marks are drawn in a 100-unit box centred on 0.
 */
function installArtInPage() {
    const TAU = Math.PI * 2;
    const INK = 0x0a0c17;
    const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const css = (n, a = 1) => {
        const [r, g, b] = rgb(n);
        return `rgba(${r},${g},${b},${a})`;
    };
    const mix = (p, q, t) => {
        const a = rgb(p);
        const b = rgb(q);
        const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
        return (c[0] << 16) | (c[1] << 8) | c[2];
    };
    const dark = (n, k) => mix(0x000000, n, k);
    const light = (n, k) => mix(n, 0xffffff, k);

    function rng(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function seedOf(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    // ---- type ------------------------------------------------------------------------------
    function setFont(ctx, s) {
        ctx.font = `${s.weight || 400} ${s.size}px "${s.family || 'Manrope'}"`;
        ctx.letterSpacing = '0px';
    }
    function widthOf(ctx, str, s) {
        setFont(ctx, s);
        return ctx.measureText(str).width + (s.spacing || 0) * s.size * Math.max(0, str.length - 1);
    }
    /** The style with its size shrunk (never grown) so the line fits `maxW`. */
    function sized(ctx, str, s) {
        if (!s.maxW) return s;
        const w100 = widthOf(ctx, str, { ...s, size: 100 });
        return { ...s, size: Math.min(s.size, (100 * s.maxW) / w100) };
    }
    function capOf(ctx, s) {
        setFont(ctx, s);
        return ctx.measureText('H').actualBoundingBoxAscent;
    }
    /** Draws one line with its baseline at y. Returns its size and box. */
    function line(ctx, str, x, y, s0) {
        const s = sized(ctx, str, s0);
        const w = widthOf(ctx, str, s);
        let x0 = x;
        if (s.align === 'center') x0 -= w / 2;
        else if (s.align === 'right') x0 -= w;
        const cap = capOf(ctx, s);
        ctx.save();
        if (s.bg) {
            const b = s.bg;
            ctx.fillStyle = b.color;
            ctx.beginPath();
            const skewPad = s.skew ? cap * s.skew : 0;
            if (s.skew) {
                const x1 = x0 - b.padX;
                const x2 = x0 + w + b.padX + skewPad;
                const top = y - cap - b.padY;
                const bottom = y + b.padY;
                const k = s.skew * (bottom - top);
                ctx.moveTo(x1 + k, top);
                ctx.lineTo(x2, top);
                ctx.lineTo(x2 - k, bottom);
                ctx.lineTo(x1, bottom);
                ctx.closePath();
            } else {
                ctx.roundRect(x0 - b.padX, y - cap - b.padY, w + b.padX * 2, cap + b.padY * 2, b.radius || 0);
            }
            ctx.fill();
        }
        setFont(ctx, s);
        ctx.letterSpacing = `${(s.spacing || 0) * s.size}px`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        if (s.skew) {
            ctx.translate(x0, y);
            ctx.transform(1, 0, -s.skew, 1, 0, 0);
            ctx.translate(-x0, -y);
        }
        if (s.glow) {
            ctx.shadowColor = s.glowColor || s.color;
            ctx.shadowBlur = s.glow;
        }
        if (s.stroke) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = s.strokeW || 4;
            ctx.strokeStyle = s.stroke;
            ctx.strokeText(str, x0, y);
        }
        ctx.fillStyle = s.color;
        ctx.fillText(str, x0, y);
        ctx.restore();
        return {
            w, x0, cap, size: s.size, base: y,
        };
    }
    /**
     * Lines stacked top-down (each `{ str, s, gap }`, gap = space above it). `top` is the top of the
     * first line's capitals, or pass `middle` to centre the block there. Returns each line's box.
     */
    function block(ctx, lines, x, top, opt = {}) {
        const laid = lines.map((l) => {
            const s = sized(ctx, l.str, { ...l.s, align: opt.align || l.s.align });
            return { ...l, s, cap: capOf(ctx, s) };
        });
        let total = 0;
        laid.forEach((l, i) => {
            total += (i ? l.gap || 0 : 0) + l.cap + (l.s.bg ? l.s.bg.padY * 2 : 0);
        });
        let y = opt.middle === undefined ? top : opt.middle - total / 2;
        return laid.map((l, i) => {
            if (i) y += l.gap || 0;
            if (l.s.bg) y += l.s.bg.padY;
            y += l.cap;
            const box = line(ctx, l.str, x, y, l.s);
            if (l.s.bg) y += l.s.bg.padY;
            return box;
        });
    }

    // ---- surfaces --------------------------------------------------------------------------
    function ground(ctx, w, h, top, bottom) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, css(top));
        g.addColorStop(1, css(bottom));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }
    function glowAt(ctx, x, y, r, col, a) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css(col, a));
        g.addColorStop(0.45, css(col, a * 0.42));
        g.addColorStop(1, css(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    function vignette(ctx, w, h, a) {
        const r = Math.hypot(w, h) / 2;
        const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.5, w / 2, h / 2, r);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${a})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }
    /** Print/LED texture: a faint seeded noise over the whole piece. */
    function grain(ctx, w, h, seed, amount) {
        const img = ctx.getImageData(0, 0, w, h);
        const d = img.data;
        const r = rng(seed);
        for (let i = 0; i < d.length; i += 4) {
            const n = (r() - 0.5) * amount;
            d[i] += n;
            d[i + 1] += n;
            d[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);
    }
    function bubbles(ctx, w, h, o) {
        const r = rng(o.seed);
        for (let i = 0; i < o.count; i++) {
            const x = r() * w;
            const y = r() * h;
            const rad = o.min + r() ** 2 * (o.max - o.min);
            const a = o.alpha * (0.35 + 0.65 * r());
            if (o.region && !o.region(x, y)) continue;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, TAU);
            if (o.ring) {
                ctx.strokeStyle = css(o.color, a);
                ctx.lineWidth = Math.max(1, rad * 0.22);
                ctx.stroke();
            } else {
                ctx.fillStyle = css(o.color, a);
                ctx.fill();
            }
        }
    }
    /** Parallel slanted stripes across a box (speed lines, sashes). */
    function stripes(ctx, x, y, w, h, o) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = o.color;
        const k = o.slant * h;
        for (let sx = x - Math.abs(k) - o.width; sx < x + w + Math.abs(k); sx += o.period) {
            ctx.beginPath();
            ctx.moveTo(sx + k, y);
            ctx.lineTo(sx + k + o.width, y);
            ctx.lineTo(sx + o.width, y + h);
            ctx.lineTo(sx, y + h);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
    /**
     * Draws `fn` on its own layer, keeps it only where `mask` (a gradient, painted over the layer
     * with destination-in) is opaque, and lays the result on `ctx`.
     */
    function masked(ctx, w, h, fn, mask) {
        const layer = document.createElement('canvas');
        layer.width = w;
        layer.height = h;
        const lctx = layer.getContext('2d');
        fn(lctx);
        lctx.globalCompositeOperation = 'destination-in';
        lctx.fillStyle = mask(lctx);
        lctx.fillRect(0, 0, w, h);
        ctx.drawImage(layer, 0, 0);
    }
    const radialMask = (x, y, r0, r1) => (c) => {
        const g = c.createRadialGradient(x, y, r0, x, y, r1);
        g.addColorStop(0, '#000');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        return g;
    };
    /**
     * Draws the part of `im` (a loaded { img, region, focus, zoom }) that fills the box: the
     * largest window of the box's aspect inside the region (divided by the picture's zoom), centred
     * on the focus as nearly as the region allows.
     */
    function place(ctx, im, dx, dy, dw, dh) {
        const { img } = im;
        const zoom = im.zoom || 1;
        const [rx, ry, rw, rh] = im.region || [0, 0, img.naturalWidth, img.naturalHeight];
        const want = dw / dh;
        let sw = rw;
        let sh = rw / want;
        if (sh > rh) {
            sh = rh;
            sw = rh * want;
        }
        sw /= zoom;
        sh /= zoom;
        const [fx, fy] = im.focus || [rx + rw / 2, ry + rh / 2];
        const sx = Math.min(Math.max(fx - sw / 2, rx), rx + rw - sw);
        const sy = Math.min(Math.max(fy - sh / 2, ry), ry + rh - sh);
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    /** Light rays fanning out from (x, y) over the whole canvas, alternating two alphas. */
    function rays(ctx, w, h, x, y, count, color, a0, a1, spin = 0) {
        const r = Math.hypot(w, h) * 1.2;
        for (let i = 0; i < count; i++) {
            const t0 = spin + (i / count) * TAU;
            const t1 = spin + ((i + 1) / count) * TAU;
            ctx.fillStyle = css(color, i % 2 ? a1 : a0);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(t0) * r, y + Math.sin(t0) * r);
            ctx.lineTo(x + Math.cos(t1) * r, y + Math.sin(t1) * r);
            ctx.closePath();
            ctx.fill();
        }
    }
    /** Ben-Day dots over a box: a grid of dots, `r` at the top growing to `r1` at the bottom. */
    function halftone(ctx, x, y, w, h, step, r0, r1, color) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.beginPath();
        let row = 0;
        for (let py = y; py < y + h + step; py += step * 0.866, row++) {
            const rr = r0 + (r1 - r0) * ((py - y) / h);
            const rad = Math.max(0.2, rr);
            for (let px = x + (row % 2 ? step / 2 : 0); px < x + w + step; px += step) {
                ctx.moveTo(px + rad, py);
                ctx.arc(px, py, rad, 0, TAU);
            }
        }
        ctx.fill();
        ctx.restore();
    }

    // ---- colour taken from a picture ---------------------------------------------------------
    function hsv(h, s, v) {
        const hh = ((h % 360) + 360) % 360;
        const c = v * s;
        const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
        const m = v - c;
        const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hh / 60) % 6];
        const to = (u) => Math.round((u + m) * 255);
        return (to(r) << 16) | (to(g) << 8) | to(b);
    }
    function toHsv(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 0) {
            if (max === r) h = 60 * (((g - b) / d) % 6);
            else if (max === g) h = 60 * ((b - r) / d + 2);
            else h = 60 * ((r - g) / d + 4);
        }
        return [(h + 360) % 360, max ? d / max : 0, max];
    }
    /** Relative luminance of an sRGB colour (0 black, 1 white). */
    function lum(n) {
        const lin = (v) => {
            const u = v / 255;
            return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
        };
        const [r, g, b] = rgb(n);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
    /**
     * The picture's dominant hue (the strongest vivid, bright hue) and an accent (the strongest
     * hue at least 50° from it, or none for a one-hue picture), from a 36-bin hue histogram.
     */
    function paletteOf(im) {
        const S = 64;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const x = c.getContext('2d', { willReadFrequently: true });
        const [rx, ry, rw, rh] = im.region || [0, 0, im.img.naturalWidth, im.img.naturalHeight];
        x.drawImage(im.img, rx, ry, rw, rh, 0, 0, S, S);
        const d = x.getImageData(0, 0, S, S).data;
        const BINS = 36;
        const hist = new Float64Array(BINS);
        const cx = new Float64Array(BINS);
        const cy = new Float64Array(BINS);
        const sat = new Float64Array(BINS);
        const count = new Float64Array(BINS);
        const val = new Float64Array(BINS);
        for (let i = 0; i < d.length; i += 4) {
            const [h, s, v] = toHsv(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
            if (v < 0.1 || s < 0.12) continue;
            const wgt = s * s * v * v;
            const bin = Math.floor(h / 10) % BINS;
            hist[bin] += wgt;
            cx[bin] += wgt * Math.cos((h * Math.PI) / 180);
            cy[bin] += wgt * Math.sin((h * Math.PI) / 180);
            sat[bin] += wgt * s;
            count[bin] += 1;
            val[bin] += v;
        }
        /** Mean brightness of the pixels round a bin: which hue lives in the lights, which in the shade. */
        const valueAt = (bin) => {
            let n = 0;
            let v = 0;
            for (const k of [-1, 0, 1]) {
                const j = (bin + k + BINS) % BINS;
                n += count[j];
                v += val[j];
            }
            return n ? v / n : 0;
        };
        const smooth = hist.map((v, i) => 0.5 * v + 0.25 * (hist[(i + BINS - 1) % BINS] + hist[(i + 1) % BINS]));
        const hueAt = (bin) => {
            let sx = 0;
            let sy = 0;
            for (const k of [-1, 0, 1]) {
                const j = (bin + k + BINS) % BINS;
                sx += cx[j];
                sy += cy[j];
            }
            return ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
        };
        let dom = 0;
        for (let i = 1; i < BINS; i++) if (smooth[i] > smooth[dom]) dom = i;
        let acc = -1;
        for (let i = 0; i < BINS; i++) {
            const dist = Math.min(Math.abs(i - dom), BINS - Math.abs(i - dom));
            if (dist >= 5 && smooth[i] >= smooth[dom] * 0.1 && (acc < 0 || smooth[i] > smooth[acc])) acc = i;
        }
        return {
            dom: hueAt(dom),
            domS: hist[dom] ? sat[dom] / hist[dom] : 0.5,
            acc: acc < 0 ? null : hueAt(acc),
            accLighter: acc >= 0 && valueAt(acc) >= valueAt(dom),
        };
    }
    /** A poster's colours from its picture's palette. */
    function coloursOf(pal) {
        const H = pal.dom;
        const mono = pal.acc === null;
        const A = mono ? H : pal.acc;
        const s = Math.min(0.85, Math.max(0.45, pal.domS));
        // Yellows only read as yellow when bright: lift the field's value round 55°.
        const yellow = Math.max(0, 1 - Math.abs(((H - 55 + 540) % 360) - 180) / 40);
        return {
            hue: H,
            accHue: A,
            mono,
            // For two-ink printing: the hue of the picture's shadows and the hue of its lights.
            shadeHue: mono || pal.accLighter ? H : A,
            lightHue: mono || pal.accLighter ? A : H,
            ink: hsv(H, Math.min(0.75, s + 0.1), 0.1),
            deep: hsv(H, Math.min(0.8, s + 0.1), 0.27),
            field: hsv(H, s * 0.9 + 0.08, 0.76 + 0.2 * yellow),
            vivid: hsv(H, 0.85, 1.0),
            accent: hsv(A, mono ? 0.4 : 0.66, 1.0),
            accentDark: hsv(A, 0.85, 0.55),
            pale: hsv(A, 0.2, 1.0),
            paper: hsv(H, 0.06, 0.97),
        };
    }
    const dot = (ctx, x, y, r) => {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
    };
    const teardrop = (ctx, x, y, r) => {
        ctx.moveTo(x, y - r * 1.9);
        ctx.bezierCurveTo(x + r * 0.3, y - r * 1.2, x + r, y - r * 0.7, x + r, y);
        ctx.arc(x, y, r, 0, Math.PI);
        ctx.bezierCurveTo(x - r, y - r * 0.7, x - r * 0.3, y - r * 1.2, x, y - r * 1.9);
        ctx.closePath();
    };
    const MARKS = {
        /** A rounded cola bottle, three drops falling beside it. */
        cascade(ctx, A, B) {
            ctx.save();
            ctx.translate(-12, 0);
            const body = new Path2D();
            body.moveTo(-6.5, -39);
            body.lineTo(-6.5, -27);
            body.bezierCurveTo(-6.5, -17, -19, -15, -19, -1);
            body.lineTo(-19, 41);
            body.quadraticCurveTo(-19, 50, -10, 50);
            body.lineTo(10, 50);
            body.quadraticCurveTo(19, 50, 19, 41);
            body.lineTo(19, -1);
            body.bezierCurveTo(19, -15, 6.5, -17, 6.5, -27);
            body.lineTo(6.5, -39);
            body.closePath();
            ctx.fillStyle = css(B);
            ctx.fill(body);
            ctx.beginPath();
            ctx.roundRect(-8.5, -50, 17, 9, 2.5);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.save();
            ctx.clip(body);
            const shade = ctx.createLinearGradient(-19, 0, 19, 0);
            shade.addColorStop(0, css(A, 0));
            shade.addColorStop(0.6, css(A, 0));
            shade.addColorStop(1, css(A, 0.28));
            ctx.fillStyle = shade;
            ctx.fillRect(-20, -40, 40, 92);
            ctx.fillStyle = css(A);
            ctx.fillRect(-20, 7, 40, 20);
            ctx.fillStyle = css(B);
            ctx.beginPath();
            teardrop(ctx, 0, 20, 4.2);
            ctx.fill();
            ctx.fillStyle = css(0xffffff, 0.9);
            ctx.beginPath();
            ctx.roundRect(-14.5, -3, 3, 7, 1.5);
            ctx.roundRect(-14.5, 31, 3, 14, 1.5);
            ctx.fill();
            ctx.restore();
            ctx.restore();
            ctx.fillStyle = css(B);
            ctx.beginPath();
            teardrop(ctx, 31, -24, 4.4);
            teardrop(ctx, 31, -1, 5.8);
            teardrop(ctx, 31, 27, 7.4);
            ctx.fill();
        },
        /** A noodle bowl with chopsticks, three steam wisps rising. */
        combo(ctx, A, B, C) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 4.6;
            ctx.strokeStyle = css(A);
            for (const [x, top] of [[-22, -40], [-6, -50], [10, -40]]) {
                const k = (-8 - top) / 4;
                ctx.beginPath();
                ctx.moveTo(x, -8);
                ctx.bezierCurveTo(x - 8, -8 - k, x + 8, -8 - 2 * k, x, -8 - 2.2 * k);
                ctx.bezierCurveTo(x - 8, -8 - 2.6 * k, x + 6, -8 - 3.4 * k, x + 1, top);
                ctx.stroke();
            }
            ctx.lineWidth = 4.2;
            ctx.strokeStyle = css(C);
            ctx.beginPath();
            ctx.moveTo(4, 0);
            ctx.lineTo(44, -42);
            ctx.moveTo(13, 2);
            ctx.lineTo(51, -35);
            ctx.stroke();
            ctx.lineWidth = 3;
            ctx.strokeStyle = css(light(A, 0.55));
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const x = -34 + i * 13;
                ctx.moveTo(x, 3);
                ctx.quadraticCurveTo(x + 4, -7, x + 9, 1);
            }
            ctx.stroke();
            ctx.fillStyle = css(B);
            ctx.beginPath();
            ctx.moveTo(-44, 2);
            ctx.lineTo(44, 2);
            ctx.bezierCurveTo(44, 30, 24, 42, 0, 42);
            ctx.bezierCurveTo(-24, 42, -44, 30, -44, 2);
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(-15, 39, 30, 8, 2.5);
            ctx.fill();
            ctx.fillStyle = css(A);
            ctx.beginPath();
            ctx.roundRect(-47, -2, 94, 7.5, 3.75);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = css(light(A, 0.3));
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            for (let x = -36; x <= 36; x += 1) {
                const y = 19 + 2.6 * Math.sin(x * 0.42);
                if (x === -36) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        },
        /** Three stacked coins under an upward chevron. */
        stack(ctx, A, B) {
            const coin = (x, y) => {
                const rx = 30;
                const ry = 9;
                const t = 10;
                ctx.fillStyle = css(dark(B, 0.6));
                ctx.beginPath();
                ctx.moveTo(x - rx, y);
                ctx.lineTo(x - rx, y + t);
                ctx.ellipse(x, y + t, rx, ry, 0, Math.PI, 0, true);
                ctx.lineTo(x + rx, y);
                ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI, false);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = css(B);
                ctx.beginPath();
                ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
                ctx.fill();
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = css(dark(B, 0.72));
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.ellipse(x, y, rx * 0.68, ry * 0.68, 0, 0, TAU);
                ctx.stroke();
                ctx.restore();
            };
            coin(0, 28);
            coin(-3, 16);
            coin(2, 4);
            ctx.strokeStyle = css(light(A, 0.4));
            ctx.lineWidth = 9;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(-23, -17);
            ctx.lineTo(0, -40);
            ctx.lineTo(23, -17);
            ctx.stroke();
        },
        /** A parcel under a bold downward arrow. */
        drop(ctx, A, B) {
            ctx.fillStyle = css(A);
            ctx.beginPath();
            ctx.moveTo(-8.5, -50);
            ctx.lineTo(8.5, -50);
            ctx.lineTo(8.5, -29);
            ctx.lineTo(22, -29);
            ctx.lineTo(0, -7);
            ctx.lineTo(-22, -29);
            ctx.lineTo(-8.5, -29);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(-31, 2, 62, 46, 4);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = css(B, 0.9);
            ctx.fillRect(-6, 2, 12, 46);
            ctx.beginPath();
            ctx.roundRect(13, 34, 12, 8, 1.5);
            ctx.fill();
        },
        /** A dumbbell. */
        level(ctx, A, B) {
            ctx.fillStyle = css(B);
            ctx.beginPath();
            ctx.roundRect(-46, -3.5, 92, 7, 3.5);
            ctx.fill();
            ctx.fillStyle = css(A);
            for (const s of [-1, 1]) {
                for (const [x0, x1, hh] of [[16, 27, 26], [29, 37, 18]]) {
                    ctx.beginPath();
                    ctx.roundRect(Math.min(s * x0, s * x1), -hh, x1 - x0, hh * 2, 3);
                    ctx.fill();
                }
            }
            ctx.fillStyle = css(B);
            for (const s of [-1, 1]) {
                ctx.beginPath();
                ctx.roundRect(Math.min(s * 39, s * 45), -7, 6, 14, 2.5);
                ctx.fill();
            }
        },
        /** A taxi in side profile, roof sign lit, speed lines behind. */
        next(ctx, A, B) {
            ctx.strokeStyle = css(A);
            ctx.lineCap = 'round';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(-72, -12);
            ctx.lineTo(-55, -12);
            ctx.moveTo(-78, 1);
            ctx.lineTo(-55, 1);
            ctx.moveTo(-70, 14);
            ctx.lineTo(-55, 14);
            ctx.stroke();
            ctx.fillStyle = css(A);
            ctx.beginPath();
            ctx.moveTo(-47, 20);
            ctx.lineTo(-47, 4);
            ctx.quadraticCurveTo(-47, -3, -39, -4);
            ctx.lineTo(-25, -5);
            ctx.lineTo(-14, -20);
            ctx.quadraticCurveTo(-12, -23, -8, -23);
            ctx.lineTo(14, -23);
            ctx.quadraticCurveTo(18, -23, 21, -20);
            ctx.lineTo(32, -6);
            ctx.lineTo(42, -4);
            ctx.quadraticCurveTo(50, -3, 50, 5);
            ctx.lineTo(50, 20);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(-6, -32, 18, 7, 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = css(B);
            ctx.beginPath();
            ctx.moveTo(-20, -6.5);
            ctx.lineTo(-11, -18.5);
            ctx.lineTo(1, -18.5);
            ctx.lineTo(1, -6.5);
            ctx.closePath();
            ctx.moveTo(4, -6.5);
            ctx.lineTo(4, -18.5);
            ctx.lineTo(14, -18.5);
            ctx.lineTo(24.5, -6.5);
            ctx.closePath();
            ctx.fill();
            ctx.fillRect(2, -4, 1.6, 20);
            ctx.fillRect(-47, 7, 97, 2.4);
            for (const x of [-27, 31]) {
                ctx.fillStyle = css(B);
                ctx.beginPath();
                dot(ctx, x, 20, 11.5);
                ctx.fill();
                ctx.strokeStyle = css(A);
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                dot(ctx, x, 20, 8.6);
                ctx.stroke();
                ctx.fillStyle = css(A);
                ctx.beginPath();
                dot(ctx, x, 20, 3.4);
                ctx.fill();
            }
        },
        /** A pair of round glasses. */
        clear(ctx, A, B) {
            ctx.strokeStyle = css(A);
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            dot(ctx, -25, 0, 20);
            dot(ctx, 25, 0, 20);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-6, -4);
            ctx.quadraticCurveTo(0, -11, 6, -4);
            ctx.moveTo(-44.5, -5);
            ctx.lineTo(-52, -11);
            ctx.moveTo(44.5, -5);
            ctx.lineTo(52, -11);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = css(B, 0.95);
            ctx.lineWidth = 3;
            for (const x of [-25, 25]) {
                ctx.beginPath();
                ctx.arc(x, 0, 13, Math.PI * 1.08, Math.PI * 1.42);
                ctx.stroke();
            }
        },
        /** A washing machine front: a rounded body, a round door, a swirl. */
        spin(ctx, A, B) {
            ctx.strokeStyle = css(A);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.roundRect(-37, -46, 74, 92, 13);
            ctx.stroke();
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(-37, -29);
            ctx.lineTo(37, -29);
            ctx.stroke();
            ctx.lineWidth = 6;
            ctx.beginPath();
            dot(ctx, 0, 9, 25);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = css(B);
            ctx.beginPath();
            dot(ctx, -23, -37.5, 3.6);
            dot(ctx, -12, -37.5, 3.6);
            ctx.fill();
            ctx.beginPath();
            ctx.roundRect(10, -40.5, 17, 6, 3);
            ctx.fill();
            ctx.fillStyle = css(B, 0.16);
            ctx.beginPath();
            dot(ctx, 0, 9, 19);
            ctx.fill();
            ctx.strokeStyle = css(B);
            ctx.lineWidth = 4;
            ctx.beginPath();
            for (let i = 0; i <= 64; i++) {
                const t = i / 64;
                const ang = -0.6 + t * Math.PI * 2.7;
                const r = 2.5 + t * 13.5;
                const px = Math.cos(ang) * r;
                const py = 9 + Math.sin(ang) * r;
                if (i) ctx.lineTo(px, py);
                else ctx.moveTo(px, py);
            }
            ctx.stroke();
        },
        /** Hale: a lotus of three petals over a still line. */
        hale(ctx, A, B, lw = 3) {
            const g = ctx.createLinearGradient(-46, 0, 46, 0);
            g.addColorStop(0, css(A));
            g.addColorStop(1, css(B));
            ctx.strokeStyle = g;
            ctx.lineWidth = lw;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, 30);
            ctx.bezierCurveTo(17, 12, 15, -18, 0, -40);
            ctx.bezierCurveTo(-15, -18, -17, 12, 0, 30);
            ctx.moveTo(0, 30);
            ctx.bezierCurveTo(-10, 12, -28, -2, -46, -6);
            ctx.bezierCurveTo(-44, 14, -26, 28, 0, 30);
            ctx.moveTo(0, 30);
            ctx.bezierCurveTo(10, 12, 28, -2, 46, -6);
            ctx.bezierCurveTo(44, 14, 26, 28, 0, 30);
            ctx.moveTo(-24, 42);
            ctx.lineTo(24, 42);
            ctx.stroke();
        },
        /** Serenity Transit: a route line with three stops in a rounded square. */
        transit(ctx, ink, cream, cyan) {
            ctx.fillStyle = css(cyan);
            ctx.beginPath();
            ctx.roundRect(-50, -50, 100, 100, 24);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = css(ink);
            ctx.beginPath();
            ctx.roundRect(-40, -7, 80, 14, 7);
            ctx.fill();
            for (const x of [-24, 0, 24]) {
                ctx.fillStyle = css(ink);
                ctx.beginPath();
                dot(ctx, x, 0, 11);
                ctx.fill();
                ctx.fillStyle = css(cream);
                ctx.beginPath();
                dot(ctx, x, 0, 6.5);
                ctx.fill();
            }
        },
    };
    function mark(ctx, name, cx, cy, size, args, glow) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(size / 100, size / 100);
        if (glow) {
            ctx.shadowColor = glow.color;
            ctx.shadowBlur = glow.blur;
        }
        MARKS[name](ctx, ...args);
        ctx.restore();
    }

    // ---- brands ----------------------------------------------------------------------------
    const UNB = 'Unbounded';
    const ORB = 'Orbitron';
    const MAN = 'Manrope';
    const MONO = 'Space Mono';
    const fine = (ctx, str, x, y, color, align = 'left') => line(ctx, str, x, y, {
        family: MONO, weight: 400, size: 10, spacing: 0.12, color, align,
    });

    const BRAND_PAINTERS = {
        cascade(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, dark(A, 0.5), dark(A, 0.14));
            const mx = wide ? w * 0.245 : w * 0.5;
            const my = wide ? h * 0.52 : h * 0.47;
            const ms = wide ? h * 0.82 : h * 0.42;
            glowAt(ctx, mx, my, ms * 0.95, A, 0.85);
            bubbles(ctx, w, h, {
                seed: seedOf(`cascade${wide}`),
                count: wide ? 90 : 80,
                min: 1.2,
                max: 5,
                alpha: 0.32,
                color: B,
                ring: true,
                region: wide
                    ? (x, y) => x < w * 0.44 || y < h * 0.17 || y > h * 0.82
                    : (x, y) => y > h * 0.21 && y < h - 92,
            });
            mark(ctx, 'cascade', mx, my, ms, [A, B], { color: css(A), blur: 22 });
            const brandType = {
                family: UNB, weight: 900, size: 84, color: css(B), glow: 16, glowColor: css(A),
            };
            const subType = {
                family: UNB, weight: 500, size: 21, spacing: 0.95, color: css(light(A, 0.6)),
            };
            const pill = {
                family: UNB,
                weight: 800,
                size: 17,
                spacing: 0.1,
                color: css(dark(A, 0.7)),
                bg: {
                    color: css(B), padX: 15, padY: 10, radius: 99,
                },
            };
            if (wide) {
                const x = w * 0.475;
                block(ctx, [
                    { str: 'CASCADE', s: { ...brandType, maxW: w * 0.49 } },
                    { str: 'COLA', gap: 13, s: subType },
                    { str: 'LET IT FALL', gap: 28, s: pill },
                ], x, 0, { middle: h * 0.47 });
                fine(ctx, 'ICE COLD IN EVERY DISTRICT', w - 16, h - 14, css(B, 0.6), 'right');
            } else {
                block(ctx, [
                    { str: 'CASCADE', s: { ...brandType, maxW: w - 36 } },
                    { str: 'COLA', gap: 12, s: { ...subType, size: 19 } },
                ], w / 2, 26, { align: 'center' });
                block(ctx, [{ str: 'LET IT FALL', s: { ...pill, size: 18 } }], w / 2, h - 66, { align: 'center' });
                fine(ctx, 'ICE COLD IN EVERY DISTRICT', w / 2, h - 14, css(B, 0.6), 'center');
            }
        },
        combo(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            const C = 0xfff1df;
            ground(ctx, w, h, 0x1d0b04, 0x0e0503);
            const mx = wide ? w * 0.74 : w * 0.5;
            const my = wide ? h * 0.44 : h * 0.33;
            const ms = wide ? h * 0.66 : h * 0.37;
            for (const [k, a] of [[0.62, 0.22], [0.82, 0.13], [1.04, 0.08]]) {
                ctx.strokeStyle = css(A, a);
                ctx.lineWidth = ms * 0.035;
                ctx.beginPath();
                dot(ctx, mx, my, ms * k);
                ctx.stroke();
            }
            glowAt(ctx, mx, my, ms * 0.9, A, 0.5);
            mark(ctx, 'combo', mx, my, ms, [A, B, C], { color: css(A), blur: 16 });
            const band = wide ? h * 0.2 : h * 0.17;
            ctx.fillStyle = css(B);
            ctx.fillRect(0, h - band, w, band);
            ctx.fillStyle = css(light(B, 0.25));
            ctx.fillRect(0, h - band, w, 2);
            const brandType = {
                family: UNB, weight: 900, size: 92, color: css(A), glow: 16,
            };
            const subType = {
                family: UNB, weight: 600, size: 24, spacing: 0.42, color: css(C),
            };
            const slogan = {
                family: UNB, weight: 800, size: 22, spacing: 0.06, color: css(C),
            };
            if (wide) {
                const x = 30;
                block(ctx, [
                    { str: 'COMBO', s: { ...brandType, maxW: w * 0.5 } },
                    { str: 'NOODLES', gap: 14, s: { ...subType, maxW: w * 0.5 } },
                ], x, 0, { middle: (h - band) * 0.5 });
                line(ctx, 'KEEP THE CHAIN GOING', w / 2, h - band / 2 + 8, {
                    ...slogan, align: 'center', maxW: w - 60,
                });
                fine(ctx, 'HOT BOWLS · OPEN LATE', w - 16, 20, css(C, 0.55), 'right');
            } else {
                block(ctx, [
                    { str: 'COMBO', s: { ...brandType, maxW: w - 36 } },
                    { str: 'NOODLES', gap: 12, s: { ...subType, maxW: w - 60 } },
                ], w / 2, h * 0.6, { align: 'center' });
                block(ctx, [
                    { str: 'KEEP THE', s: { ...slogan, size: 20 } },
                    { str: 'CHAIN GOING', gap: 8, s: { ...slogan, size: 20 } },
                ], w / 2, 0, { align: 'center', middle: h - band / 2 });
                fine(ctx, 'HOT BOWLS · OPEN LATE', w / 2, 22, css(C, 0.55), 'center');
            }
        },
        stack(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, dark(A, 0.32), 0x02040d);
            ctx.fillStyle = css(A, 0.13);
            for (let y = 10; y < h; y += 14) ctx.fillRect(0, y, w, 1);
            const mx = wide ? w * 0.24 : w * 0.5;
            const my = wide ? h * 0.52 : h * 0.53;
            const ms = wide ? h * 0.74 : h * 0.4;
            glowAt(ctx, mx, my, ms * 1.05, A, 0.7);
            mark(ctx, 'stack', mx, my, ms, [A, B], { color: css(B, 0.8), blur: 14 });
            const brandType = {
                family: ORB, weight: 900, size: 88, color: css(0xffffff), glow: 18, glowColor: css(A),
            };
            const subType = {
                family: ORB, weight: 700, size: 26, spacing: 0.34, color: css(B),
            };
            const slogan = {
                family: MAN, weight: 800, size: 17, spacing: 0.18, color: css(light(A, 0.55)),
            };
            if (wide) {
                const x = w * 0.46;
                const boxes = block(ctx, [
                    { str: 'STACK', s: { ...brandType, maxW: w * 0.5 } },
                    { str: 'SAVINGS', gap: 14, s: { ...subType, maxW: w * 0.5 } },
                    { str: 'BUILD ON SOLID GROUND', gap: 30, s: { ...slogan, maxW: w * 0.5 } },
                ], x, 0, { middle: h * 0.48 });
                ctx.fillStyle = css(B);
                ctx.fillRect(x, boxes[2].base - boxes[2].cap - 14, 44, 3);
                fine(ctx, 'INTEREST COMPOUNDS NIGHTLY', w - 16, h - 14, css(0xffffff, 0.45), 'right');
            } else {
                block(ctx, [
                    { str: 'STACK', s: { ...brandType, maxW: w - 40 } },
                    { str: 'SAVINGS', gap: 14, s: { ...subType, maxW: w - 50 } },
                ], w / 2, 30, { align: 'center' });
                const boxes = block(ctx, [
                    { str: 'BUILD ON', s: { ...slogan, size: 19 } },
                    { str: 'SOLID GROUND', gap: 10, s: { ...slogan, size: 19 } },
                ], w / 2, h * 0.79, { align: 'center' });
                ctx.fillStyle = css(B);
                ctx.fillRect(w / 2 - 22, boxes[0].base - boxes[0].cap - 16, 44, 3);
                fine(ctx, 'INTEREST COMPOUNDS NIGHTLY', w / 2, h - 14, css(0xffffff, 0.45), 'center');
            }
        },
        drop(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, B, dark(B, 0.35));
            stripes(ctx, 0, 0, w, h, {
                color: css(A, 0.07), slant: 0.32, width: 26, period: 64,
            });
            const mx = wide ? w * 0.77 : w * 0.5;
            const my = wide ? h * 0.5 : h * 0.29;
            const ms = wide ? h * 0.76 : h * 0.4;
            glowAt(ctx, mx, my, ms, A, 0.32);
            mark(ctx, 'drop', mx, my, ms, [A, B], { color: css(A), blur: 18 });
            const brandType = {
                family: UNB, weight: 900, size: 116, color: css(A), skew: 0.2, glow: 14,
            };
            const subType = {
                family: UNB, weight: 600, size: 24, spacing: 0.36, color: css(light(A, 0.7)), skew: 0.2,
            };
            const slogan = {
                family: UNB,
                weight: 900,
                size: 20,
                spacing: 0.08,
                color: css(dark(B, 0.8)),
                skew: 0.2,
                bg: { color: css(A), padX: 12, padY: 9 },
            };
            if (wide) {
                const x = 30;
                block(ctx, [
                    { str: 'DROP', s: { ...brandType, maxW: w * 0.5 } },
                    { str: 'COURIERS', gap: 14, s: { ...subType, maxW: w * 0.52 } },
                    { str: 'HARD AND FAST', gap: 24, s: slogan },
                ], x, 0, { middle: h * 0.5 });
                fine(ctx, 'DOOR TO DOOR · DAY AND NIGHT', w - 16, h - 14, css(A, 0.6), 'right');
            } else {
                block(ctx, [
                    { str: 'DROP', s: { ...brandType, maxW: w - 50 } },
                    { str: 'COURIERS', gap: 13, s: { ...subType, maxW: w - 56 } },
                    { str: 'HARD AND FAST', gap: 26, s: slogan },
                ], w / 2, h * 0.57, { align: 'center' });
                fine(ctx, 'DOOR TO DOOR · DAY AND NIGHT', w / 2, h - 14, css(A, 0.6), 'center');
            }
        },
        level(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, 0x1d0412, 0x0a0208);
            const mx = wide ? w * 0.77 : w * 0.5;
            const my = wide ? h * 0.48 : h * 0.43;
            const ms = wide ? h * 0.76 : h * 0.56;
            masked(ctx, w, h, (c) => stripes(c, 0, 0, w, h, {
                color: css(A, 0.24), slant: 0.5, width: 9, period: 22,
            }), radialMask(mx, my, ms * 0.2, ms * 0.85));
            glowAt(ctx, mx, my, ms * 0.7, A, 0.55);
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(-0.22);
            mark(ctx, 'level', 0, 0, ms, [A, B], { color: css(A), blur: 20 });
            ctx.restore();
            const brandType = {
                family: UNB, weight: 900, size: 96, color: css(A), glow: 16,
            };
            const gymType = {
                family: UNB, weight: 900, size: 96, color: css(B), glow: 12,
            };
            const slogan = {
                family: UNB, weight: 700, size: 18, spacing: 0.16, color: css(0xffffff),
            };
            if (wide) {
                const x = 30;
                const boxes = block(ctx, [
                    { str: 'LEVEL', s: { ...brandType, maxW: w * 0.44 } },
                    { str: 'GYM', gap: 18, s: { ...gymType, maxW: w * 0.44 } },
                    { str: 'ONE MORE LEVEL', gap: 30, s: { ...slogan, maxW: w * 0.44 } },
                ], x, 0, { middle: h * 0.5 });
                ctx.fillStyle = css(B);
                ctx.fillRect(x, boxes[2].base - boxes[2].cap - 14, 30, 3);
                fine(ctx, 'OPEN ALL NIGHT', w - 16, h - 14, css(B, 0.7), 'right');
            } else {
                block(ctx, [{ str: 'LEVEL', s: { ...brandType, maxW: w - 40 } }], w / 2, 26, { align: 'center' });
                block(ctx, [
                    { str: 'GYM', s: { ...gymType, size: 76 } },
                    { str: 'ONE MORE LEVEL', gap: 24, s: { ...slogan, maxW: w - 50 } },
                ], w / 2, h * 0.66, { align: 'center' });
                fine(ctx, 'OPEN ALL NIGHT', w / 2, h - 14, css(B, 0.7), 'center');
            }
        },
        next(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, B, dark(B, 0.6));
            ctx.fillStyle = css(A);
            ctx.beginPath();
            if (wide) {
                ctx.moveTo(0, 0);
                ctx.lineTo(w * 0.53, 0);
                ctx.lineTo(w * 0.44, h);
                ctx.lineTo(0, h);
            } else {
                ctx.moveTo(0, 0);
                ctx.lineTo(w, 0);
                ctx.lineTo(w, h * 0.36);
                ctx.lineTo(0, h * 0.44);
            }
            ctx.closePath();
            ctx.fill();
            stripes(ctx, 0, 0, w, h, {
                color: css(dark(A, 0.82), 0.14), slant: 0.6, width: 4, period: 16,
            });
            ctx.fillStyle = css(A);
            ctx.beginPath();
            if (wide) {
                ctx.moveTo(0, 0);
                ctx.lineTo(w * 0.53, 0);
                ctx.lineTo(w * 0.44, h);
                ctx.lineTo(0, h);
            } else {
                ctx.moveTo(0, 0);
                ctx.lineTo(w, 0);
                ctx.lineTo(w, h * 0.36);
                ctx.lineTo(0, h * 0.44);
            }
            ctx.closePath();
            ctx.fill();
            const brandType = {
                family: ORB, weight: 900, size: 118, color: css(B),
            };
            const subType = {
                family: ORB, weight: 900, size: 30, spacing: 0.5, color: css(B),
            };
            const slogan = {
                family: ORB, weight: 700, size: 17, spacing: 0.12, color: css(A),
            };
            if (wide) {
                const mx = w * 0.73;
                const my = h * 0.42;
                const ms = h * 0.62;
                glowAt(ctx, mx, my, ms * 0.8, A, 0.25);
                mark(ctx, 'next', mx, my, ms, [A, B], { color: css(A), blur: 16 });
                block(ctx, [
                    { str: 'NEXT', s: { ...brandType, maxW: w * 0.38 } },
                    { str: 'TAXI', gap: 16, s: { ...subType, maxW: w * 0.36 } },
                ], 28, 0, { middle: h * 0.5 });
                block(ctx, [
                    { str: 'ALWAYS ONE', s: slogan },
                    { str: 'MORE COMING', gap: 8, s: slogan },
                ], mx, h * 0.72, { align: 'center' });
                fine(ctx, 'HAIL ANY CORNER', w - 16, h - 14, css(A, 0.55), 'right');
            } else {
                block(ctx, [
                    { str: 'NEXT', s: { ...brandType, maxW: w - 44 } },
                    { str: 'TAXI', gap: 12, s: { ...subType, size: 26 } },
                ], w / 2, 34, { align: 'center' });
                const mx = w * 0.52;
                const my = h * 0.63;
                const ms = h * 0.34;
                glowAt(ctx, mx, my, ms * 0.9, A, 0.25);
                mark(ctx, 'next', mx, my, ms, [A, B], { color: css(A), blur: 14 });
                block(ctx, [
                    { str: 'ALWAYS ONE', s: { ...slogan, size: 17 } },
                    { str: 'MORE COMING', gap: 9, s: { ...slogan, size: 17 } },
                ], w / 2, h * 0.8, { align: 'center' });
                fine(ctx, 'HAIL ANY CORNER', w / 2, h - 12, css(A, 0.55), 'center');
            }
        },
        clear(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, 0x04121c, 0x01060b);
            const mx = wide ? w * 0.29 : w * 0.5;
            const my = wide ? h * 0.47 : h * 0.33;
            const ms = wide ? h * 0.64 : h * 0.55;
            const k = ms / 100;
            const lens = new Path2D();
            lens.arc(mx - 25 * k, my, 20 * k, 0, TAU);
            lens.moveTo(mx + 45 * k, my);
            lens.arc(mx + 25 * k, my, 20 * k, 0, TAU);
            // Eye-test lines: blurred out in the street, sharp through the lenses.
            const lines = (c, alpha, blurPx) => {
                c.save();
                if (blurPx) c.filter = `blur(${blurPx}px)`;
                c.fillStyle = css(B, alpha);
                let y = my - ms * 0.42;
                let t = 5;
                while (y < my + ms * 0.46) {
                    c.fillRect(0, y, w, Math.max(1, t));
                    y += t * 2.4 + 3;
                    t *= 0.84;
                }
                c.restore();
            };
            masked(ctx, w, h, (c) => lines(c, 0.6, 2.6), radialMask(mx, my, ms * 0.5, ms * 1.25));
            ctx.save();
            ctx.clip(lens);
            ctx.fillStyle = css(0x02080e);
            ctx.fillRect(0, 0, w, h);
            glowAt(ctx, mx, my, ms * 0.6, A, 0.25);
            lines(ctx, 0.9, 0);
            ctx.restore();
            mark(ctx, 'clear', mx, my, ms, [A, B], { color: css(A), blur: 16 });
            const brandType = {
                family: MAN, weight: 800, size: 74, spacing: 0.14, color: css(B), glow: 14, glowColor: css(A, 0.8),
            };
            const subType = {
                family: MAN, weight: 300, size: 28, spacing: 0.62, color: css(A),
            };
            const slogan = {
                family: MAN, weight: 700, size: 17, spacing: 0.24, color: css(B),
            };
            if (wide) {
                const x = w * 0.55;
                block(ctx, [
                    { str: 'CLEAR', s: { ...brandType, maxW: w * 0.42 } },
                    { str: 'OPTICS', gap: 14, s: { ...subType, maxW: w * 0.42 } },
                    { str: 'SEE EVERY LINE', gap: 30, s: { ...slogan, maxW: w * 0.42 } },
                ], x, 0, { middle: h * 0.5 });
                fine(ctx, 'EYE TESTS · FRAMES · LENSES', w - 16, h - 14, css(B, 0.5), 'right');
            } else {
                block(ctx, [
                    { str: 'CLEAR', s: { ...brandType, maxW: w - 40 } },
                    { str: 'OPTICS', gap: 13, s: { ...subType, maxW: w - 40 } },
                    { str: 'SEE EVERY LINE', gap: 30, s: { ...slogan, maxW: w - 50 } },
                ], w / 2, h * 0.6, { align: 'center' });
                fine(ctx, 'EYE TESTS · FRAMES · LENSES', w / 2, h - 14, css(B, 0.5), 'center');
            }
        },
        spin(ctx, w, h, b, wide) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, 0x150a2e, 0x07040f);
            bubbles(ctx, w, h, {
                seed: seedOf(`spin${wide}`), count: wide ? 46 : 40, min: 3, max: 20, alpha: 0.3, color: B, ring: true,
            });
            const mx = wide ? w * 0.23 : w * 0.5;
            const my = wide ? h * 0.5 : h * 0.31;
            const ms = wide ? h * 0.74 : h * 0.4;
            glowAt(ctx, mx, my, ms * 0.95, A, 0.6);
            mark(ctx, 'spin', mx, my, ms, [A, B], { color: css(A), blur: 16 });
            const spinType = {
                family: UNB, weight: 800, size: 96, color: css(B), glow: 14,
            };
            const cycleType = {
                family: UNB, weight: 800, size: 96, color: css(light(A, 0.25)), glow: 14, glowColor: css(A),
            };
            const slogan = {
                family: MAN, weight: 800, size: 18, spacing: 0.3, color: css(0xffffff),
            };
            if (wide) {
                const x = w * 0.45;
                block(ctx, [
                    { str: 'SPIN', s: { ...spinType, maxW: w * 0.46 } },
                    { str: 'CYCLE', gap: 10, s: { ...cycleType, maxW: w * 0.46 } },
                    { str: 'WASH · DRY · FOLD', gap: 26, s: { ...slogan, maxW: w * 0.48 } },
                ], x, 0, { middle: h * 0.5 });
                fine(ctx, 'SELF SERVICE · OPEN 24H', w - 16, h - 14, css(B, 0.55), 'right');
            } else {
                block(ctx, [
                    { str: 'SPIN', s: { ...spinType, size: 84 } },
                    { str: 'CYCLE', gap: 10, s: { ...cycleType, maxW: w - 44 } },
                    { str: 'WASH · DRY · FOLD', gap: 26, s: { ...slogan, maxW: w - 50 } },
                ], w / 2, h * 0.56, { align: 'center' });
                fine(ctx, 'SELF SERVICE · OPEN 24H', w / 2, h - 14, css(B, 0.55), 'center');
            }
        },
    };

    // ---- Hale ------------------------------------------------------------------------------
    function paintHale(ctx, w, h, b, wide, ring) {
        const A = b.a;
        const B = b.b;
        const C = 0xeef3f6;
        ground(ctx, w, h, 0x071119, 0x0c0b1b);
        glowAt(ctx, w * 0.1, h * 0.12, h * 1.1, A, 0.16);
        glowAt(ctx, w * 0.95, h * 0.95, h * 1.1, B, 0.16);
        const X = ring[0] * w;
        const Y = ring[1] * h;
        const R = ring[2] * h;
        // A quiet halo round the ring area, and the area itself left as a soft dark well.
        const halo = ctx.createRadialGradient(X, Y, R, X, Y, R * 1.6);
        halo.addColorStop(0, css(A, 0.12));
        halo.addColorStop(0.4, css(B, 0.06));
        halo.addColorStop(1, css(B, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, w, h);
        const well = ctx.createRadialGradient(X, Y, 0, X, Y, R * 1.2);
        well.addColorStop(0, 'rgba(3,6,11,0.7)');
        well.addColorStop(0.7, 'rgba(3,6,11,0.6)');
        well.addColorStop(0.86, 'rgba(3,6,11,0.32)');
        well.addColorStop(1, 'rgba(3,6,11,0)');
        ctx.fillStyle = well;
        ctx.fillRect(X - R * 1.2, Y - R * 1.2, R * 2.4, R * 2.4);
        const word = {
            family: MAN, weight: 300, size: 62, spacing: 0.42, color: css(C),
        };
        const slogan = {
            family: MAN, weight: 600, size: 14, spacing: 0.3, color: css(A),
        };
        const breath = {
            family: MONO, weight: 400, size: 13, spacing: 0.08, color: css(B),
        };
        const quiet = {
            family: MAN, weight: 400, size: 15, spacing: 0.06, color: css(C, 0.88),
        };
        const rule = (x, y, len) => {
            const g = ctx.createLinearGradient(x, 0, x + len, 0);
            g.addColorStop(0, css(A, 0.9));
            g.addColorStop(1, css(B, 0.9));
            ctx.fillStyle = g;
            ctx.fillRect(x, y, len, 1.5);
        };
        if (wide) {
            const x = 38;
            mark(ctx, 'hale', x + 22, 62, 46, [A, B, 3.2]);
            const boxes = block(ctx, [
                { str: 'HALE', s: word },
                { str: 'BREATHE IN THE CITY', gap: 18, s: slogan },
                { str: 'INHALE 4 · EXHALE 6', gap: 34, s: breath },
                { str: 'TAKE A BREATH.', gap: 22, s: quiet },
                { str: 'THE CITY CAN WAIT.', gap: 9, s: quiet },
            ], x, 114);
            rule(x, boxes[1].base + 15, 70);
        } else {
            mark(ctx, 'hale', w / 2, 36, 38, [A, B, 3.4]);
            block(ctx, [{ str: 'HALE', s: { ...word, size: 52 } }], w / 2, 70, { align: 'center' });
            const boxes = block(ctx, [
                { str: 'BREATHE IN THE CITY', s: { ...slogan, size: 15, maxW: w - 40 } },
                { str: 'INHALE 4 · EXHALE 6', gap: 26, s: breath },
                { str: 'TAKE A BREATH.', gap: 20, s: { ...quiet, size: 16 } },
                { str: 'THE CITY CAN WAIT.', gap: 10, s: { ...quiet, size: 16 } },
            ], w / 2, Y + R + 28, { align: 'center' });
            rule(w / 2 - 30, boxes[0].base + 12, 60);
        }
    }

    // ---- second brand posters ------------------------------------------------------------------
    /** A comic burst: a jagged star, a little wider than tall. */
    function burst(ctx, x, y, R, spikes, seed) {
        const r = rng(seed);
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
            const rad = i % 2 ? R * (0.6 + 0.08 * r()) : R * (0.92 + 0.16 * r());
            const px = x + Math.cos(a) * rad * 1.15;
            const py = y + Math.sin(a) * rad * 0.85;
            if (i) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
        }
        ctx.closePath();
    }
    /** Seeded bars of a barcode across a box. */
    function barcode(ctx, x, y, w, h, seed, color) {
        const r = rng(seed);
        ctx.fillStyle = color;
        let px = x;
        while (px < x + w) {
            const bw = 1 + Math.floor(r() * 3);
            if (r() > 0.35) ctx.fillRect(px, y, Math.min(bw, x + w - px), h);
            px += bw + 1;
        }
    }
    /** The courier's arrow alone (the top of its mark), for patterns. */
    function arrow(ctx, x, y, k) {
        ctx.moveTo(x - 8.5 * k, y - 21 * k);
        ctx.lineTo(x + 8.5 * k, y - 21 * k);
        ctx.lineTo(x + 8.5 * k, y);
        ctx.lineTo(x + 22 * k, y);
        ctx.lineTo(x, y + 22 * k);
        ctx.lineTo(x - 22 * k, y);
        ctx.lineTo(x - 8.5 * k, y);
        ctx.closePath();
    }

    /**
     * Each brand's second poster: the same campaign (colours, mark, name, slogan) in another
     * designer's hands — a product close-up, a comic strip, type alone, a parcel label, a price
     * tag, the roof sign, an eye chart, a wall of washer doors.
     */
    const BRAND_POSTERS_2 = {
        cascade(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, B, mix(B, A, 0.16));
            const mx = w * 0.5;
            const my = h * 0.33;
            const ms = h * 0.56;
            rays(ctx, w, h, mx, my, 32, A, 0.09, 0, 0.05);
            glowAt(ctx, mx, my, ms * 0.55, 0xffffff, 0.55);
            ctx.save();
            ctx.translate(mx + 14, my);
            ctx.rotate(0.16);
            mark(ctx, 'cascade', 0, 0, ms, [B, A], { color: css(dark(A, 0.45), 0.4), blur: 26 });
            ctx.restore();
            const pill = {
                family: UNB,
                weight: 800,
                size: 15,
                spacing: 0.14,
                color: css(B),
                bg: {
                    color: css(A), padX: 14, padY: 9, radius: 99,
                },
            };
            block(ctx, [{ str: 'CASCADE COLA', s: pill }], w / 2, h - 46, { align: 'center' });
            const head = {
                family: UNB, weight: 900, size: 60, color: css(A), maxW: w - 44,
            };
            block(ctx, [
                { str: 'LET IT', s: head },
                { str: 'FALL', gap: 8, s: head },
            ], w / 2, 0, { align: 'center', middle: h - 118 });
        },
        combo(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            const C = 0xfff1df;
            const K = 0x1a0b06;
            ground(ctx, w, h, C, 0xf5e2c8);
            const panel = (x, y, pw, ph, fill, fn) => {
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, pw, ph);
                ctx.clip();
                ctx.fillStyle = css(fill);
                ctx.fillRect(x, y, pw, ph);
                fn(x, y, pw, ph);
                ctx.restore();
                ctx.strokeStyle = css(K);
                ctx.lineWidth = 3.5;
                ctx.strokeRect(x, y, pw, ph);
            };
            const m = 11;
            const gut = 8;
            const fw = w - m * 2;
            panel(m, m, fw, 96, B, (x, y, pw, ph) => {
                halftone(ctx, x, y, pw, ph, 7, 0.5, 2.4, css(dark(B, 0.7), 0.45));
                block(ctx, [
                    {
                        str: 'COMBO',
                        s: {
                            family: UNB,
                            weight: 900,
                            size: 66,
                            color: css(C),
                            maxW: pw - 30,
                            stroke: css(K),
                            strokeW: 6,
                        },
                    },
                    {
                        str: 'NOODLES',
                        gap: 10,
                        s: {
                            family: UNB, weight: 800, size: 14, spacing: 0.6, color: css(0xffe14a),
                        },
                    },
                ], w / 2, 0, { align: 'center', middle: y + ph / 2 + 1 });
            });
            const p1y = m + 96 + gut;
            const p1h = 196;
            panel(m, p1y, fw, p1h, A, (x, y, pw, ph) => {
                rays(ctx, w, h, w * 0.4, y + ph * 0.62, 24, light(A, 0.55), 0.3, 0);
                halftone(ctx, x, y, pw, ph, 8, 0.6, 2.6, css(dark(A, 0.6), 0.25));
                mark(ctx, 'combo', w * 0.4, y + ph * 0.58, 150, [C, B, K], { color: css(K, 0.35), blur: 10 });
                ctx.save();
                burst(ctx, w * 0.76, y + 52, 54, 12, seedOf('combo-burst'));
                ctx.fillStyle = css(0xffe14a);
                ctx.fill();
                ctx.strokeStyle = css(K);
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.translate(w * 0.76, y + 52);
                ctx.rotate(-0.14);
                line(ctx, 'SLURP!', 0, 6, {
                    family: UNB, weight: 900, size: 16, color: css(B), align: 'center',
                });
                ctx.restore();
            });
            const capH = 46;
            const p2y = p1y + p1h + gut;
            const p2h = h - m - capH - gut - p2y;
            const pw2 = (fw - gut) / 2;
            panel(m, p2y, pw2, p2h, C, (x, y, pw, ph) => {
                halftone(ctx, x, y, pw, ph, 7, 1.8, 0.4, css(B, 0.2));
                ctx.lineCap = 'round';
                ctx.lineWidth = 3.5;
                ctx.strokeStyle = css(A);
                for (const k of [-1, 0, 1]) {
                    const sx = x + pw / 2 + k * 18;
                    ctx.beginPath();
                    ctx.moveTo(sx, y + 46);
                    ctx.bezierCurveTo(sx - 9, y + 38, sx + 9, y + 28, sx, y + 16);
                    ctx.stroke();
                }
                block(ctx, [
                    {
                        str: 'HOT',
                        s: {
                            family: UNB,
                            weight: 900,
                            size: 40,
                            color: css(B),
                            stroke: css(K),
                            strokeW: 5,
                            maxW: pw - 20,
                        },
                    },
                    {
                        str: 'BOWLS',
                        gap: 8,
                        s: {
                            family: UNB, weight: 800, size: 14, spacing: 0.3, color: css(K),
                        },
                    },
                ], x + pw / 2, y + 58, { align: 'center' });
            });
            panel(m + pw2 + gut, p2y, pw2, p2h, K, (x, y, pw, ph) => {
                bubbles(ctx, w, h, {
                    seed: seedOf('combo-stars'),
                    count: 40,
                    min: 0.6,
                    max: 1.6,
                    alpha: 0.8,
                    color: C,
                    region: (px, py) => px > x && py > y,
                });
                ctx.fillStyle = css(0xffe9a8);
                ctx.beginPath();
                dot(ctx, x + pw - 30, y + 30, 15);
                ctx.fill();
                ctx.fillStyle = css(K);
                ctx.beginPath();
                dot(ctx, x + pw - 24, y + 25, 13);
                ctx.fill();
                block(ctx, [
                    {
                        str: 'OPEN',
                        s: {
                            family: UNB, weight: 900, size: 28, color: css(A), maxW: pw - 20,
                        },
                    },
                    {
                        str: 'LATE',
                        gap: 7,
                        s: {
                            family: UNB, weight: 900, size: 28, color: css(A), maxW: pw - 20,
                        },
                    },
                ], x + 14, y + ph - 70);
            });
            panel(m, h - m - capH, fw, capH, 0xffe14a, (x, y, pw, ph) => {
                line(ctx, 'KEEP THE CHAIN GOING', w / 2, y + ph / 2 + 6, {
                    family: UNB, weight: 900, size: 16, color: css(K), align: 'center', maxW: pw - 24,
                });
            });
        },
        stack(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, dark(A, 0.3), 0x02040d);
            ctx.fillStyle = css(A, 0.1);
            for (let y = 12; y < h; y += 12) ctx.fillRect(0, y, w, 1);
            ctx.save();
            ctx.shadowColor = css(A);
            ctx.shadowBlur = 14;
            ctx.strokeStyle = css(light(A, 0.4));
            ctx.lineWidth = 7;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(w / 2 - 24, 62);
            ctx.lineTo(w / 2, 38);
            ctx.lineTo(w / 2 + 24, 62);
            ctx.stroke();
            ctx.restore();
            block(ctx, [
                {
                    str: 'BUILD ON',
                    s: {
                        family: MAN, weight: 800, size: 20, spacing: 0.2, color: css(0xffffff),
                    },
                },
                {
                    str: 'SOLID GROUND',
                    gap: 10,
                    s: {
                        family: MAN, weight: 800, size: 20, spacing: 0.2, color: css(0xffffff),
                    },
                },
            ], w / 2, 88, { align: 'center' });
            // The name stacked on itself from the foot up, each step lighter and narrower.
            const base = sized(ctx, 'STACK', {
                family: ORB, weight: 900, size: 120, maxW: w - 30,
            }).size;
            const steps = [
                {
                    k: 1, weight: 900, color: css(B), glow: 18,
                },
                { k: 0.74, weight: 900, color: css(0xffffff) },
                { k: 0.54, weight: 700, color: css(light(A, 0.35)) },
                { k: 0.38, weight: 700, color: css(0xffffff, 0.62) },
                { k: 0.27, weight: 400, color: css(0xffffff, 0.42) },
                { k: 0.19, weight: 400, color: css(0xffffff, 0.28) },
            ];
            let y = h - 52;
            for (const st of steps) {
                const s = {
                    family: ORB,
                    weight: st.weight,
                    size: base * st.k,
                    color: st.color,
                    align: 'center',
                    glow: st.glow,
                    glowColor: css(B, 0.7),
                };
                const box = line(ctx, 'STACK', w / 2, y, s);
                y -= box.cap + Math.max(5, base * st.k * 0.16);
            }
            ctx.fillStyle = css(B);
            ctx.fillRect(w / 2 - 22, h - 38, 44, 3);
            fine(ctx, 'STACK SAVINGS · INTEREST COMPOUNDS NIGHTLY', w / 2, h - 16, css(0xffffff, 0.5), 'center');
        },
        drop(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            const K = 0x101511;
            ground(ctx, w, h, B, dark(B, 0.45));
            ctx.fillStyle = css(A, 0.13);
            ctx.beginPath();
            for (let row = 0, y = 18; y < h + 30; row++, y += 44) {
                for (let x = row % 2 ? 22 : 0; x < w + 30; x += 44) arrow(ctx, x, y, 0.5);
            }
            ctx.fill();
            ctx.save();
            ctx.translate(w / 2, h * 0.49);
            ctx.rotate(-0.06);
            const lw = w - 62;
            const lh = h - 132;
            const lx = -lw / 2;
            const ly = -lh / 2;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur = 18;
            ctx.shadowOffsetY = 6;
            ctx.fillStyle = css(0xf6f7f1);
            ctx.beginPath();
            ctx.roundRect(lx, ly, lw, lh, 6);
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = css(K);
            ctx.beginPath();
            ctx.roundRect(lx, ly, lw, 40, [6, 6, 0, 0]);
            ctx.fill();
            line(ctx, 'DROP COURIERS', lx + 12, ly + 26, {
                family: UNB, weight: 800, size: 13, spacing: 0.08, color: css(A),
            });
            ctx.fillStyle = css(A);
            ctx.beginPath();
            arrow(ctx, lx + lw - 20, ly + 21, 0.42);
            ctx.fill();
            const boxes = block(ctx, [
                {
                    str: 'DROP',
                    s: {
                        family: UNB, weight: 900, size: 92, color: css(K), skew: 0.2, maxW: lw - 34,
                    },
                },
                {
                    str: 'HARD AND FAST',
                    gap: 16,
                    s: {
                        family: UNB,
                        weight: 900,
                        size: 15,
                        spacing: 0.06,
                        color: css(K),
                        skew: 0.2,
                        bg: { color: css(A), padX: 10, padY: 7 },
                    },
                },
            ], lx + 16, ly + 62);
            let y = boxes[1].base + 26;
            ctx.fillStyle = css(K, 0.8);
            ctx.fillRect(lx + 14, y - 12, lw - 28, 1.5);
            for (const [k, v] of [['FROM', 'ANY DOOR IN THE CITY'], ['TO', 'YOUR DOOR, TONIGHT']]) {
                y += 8;
                line(ctx, k, lx + 16, y, {
                    family: MONO, weight: 400, size: 9, spacing: 0.1, color: css(K, 0.6),
                });
                line(ctx, v, lx + 56, y, {
                    family: MONO, weight: 700, size: 10, color: css(K), maxW: lw - 72,
                });
                y += 14;
            }
            barcode(ctx, lx + 16, ly + lh - 62, lw - 32, 36, seedOf('drop-label'), css(K));
            line(ctx, 'DRP 0420 7781 05', lx + 16, ly + lh - 14, {
                family: MONO, weight: 400, size: 9, spacing: 0.2, color: css(K, 0.8),
            });
            // The priority stamp.
            ctx.save();
            ctx.translate(lx + lw - 52, ly + lh - 128);
            ctx.rotate(0.32);
            ctx.strokeStyle = css(dark(A, 0.55), 0.9);
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            dot(ctx, 0, 0, 34);
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.beginPath();
            dot(ctx, 0, 0, 22);
            ctx.stroke();
            circleText(ctx, 'DAY AND NIGHT · DAY AND NIGHT · ', 0, 0, 28, {
                family: MONO, weight: 700, size: 6.5, color: css(dark(A, 0.55), 0.9),
            }, true);
            line(ctx, 'PRIORITY', 0, 3, {
                family: UNB, weight: 900, size: 7.5, color: css(dark(A, 0.55)), align: 'center',
            });
            ctx.restore();
            ctx.restore();
            fine(ctx, 'DOOR TO DOOR · DAY AND NIGHT', w / 2, h - 14, css(A, 0.7), 'center');
        },
        level(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            const K = 0x1d0412;
            ground(ctx, w, h, K, 0x0a0208);
            stripes(ctx, 0, 0, w, h, {
                color: css(A, 0.1), slant: 0.5, width: 10, period: 26,
            });
            const hx = w / 2;
            const hy = 82;
            const tw = w - 84;
            const th = h - 196;
            ctx.save();
            ctx.translate(hx, hy);
            ctx.rotate(0.08);
            const tag = new Path2D();
            tag.moveTo(-tw / 2, 34);
            tag.lineTo(-tw / 2 + 52, -18);
            tag.lineTo(tw / 2 - 52, -18);
            tag.lineTo(tw / 2, 34);
            tag.lineTo(tw / 2, th);
            tag.lineTo(-tw / 2, th);
            tag.closePath();
            ctx.save();
            ctx.shadowColor = css(A, 0.55);
            ctx.shadowBlur = 26;
            ctx.fillStyle = css(B);
            ctx.fill(tag);
            ctx.restore();
            ctx.strokeStyle = css(dark(B, 0.6));
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.roundRect(-tw / 2 + 10, 42, tw - 20, th - 52, 4);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = css(K);
            ctx.beginPath();
            dot(ctx, 0, 4, 9);
            ctx.fill();
            ctx.strokeStyle = css(dark(B, 0.55));
            ctx.lineWidth = 3;
            ctx.beginPath();
            dot(ctx, 0, 4, 12);
            ctx.stroke();
            mark(ctx, 'level', 0, 64, 74, [A, K]);
            block(ctx, [
                {
                    str: '+1',
                    s: {
                        family: UNB, weight: 900, size: 132, color: css(A), maxW: tw - 40,
                    },
                },
                {
                    str: 'LEVEL GYM',
                    gap: 18,
                    s: {
                        family: UNB, weight: 900, size: 26, color: css(K), maxW: tw - 40,
                    },
                },
                {
                    str: 'ONE MORE LEVEL',
                    gap: 14,
                    s: {
                        family: MAN, weight: 800, size: 13, spacing: 0.16, color: css(K, 0.85), maxW: tw - 40,
                    },
                },
            ], 0, 102, { align: 'center' });
            ctx.restore();
            ctx.strokeStyle = css(0xfff1e0, 0.85);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hx - 40, 0);
            ctx.bezierCurveTo(hx - 30, 40, hx - 6, 60, hx, hy + 4);
            ctx.stroke();
            line(ctx, 'OPEN ALL NIGHT', w / 2, h - 40, {
                family: UNB, weight: 700, size: 17, spacing: 0.14, color: css(0xffffff), align: 'center', maxW: w - 40,
            });
            fine(ctx, 'NO CONTRACTS · ALL LEVELS', w / 2, h - 16, css(B, 0.7), 'center');
        },
        next(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, 0x07070b, 0x100e07);
            const r = rng(seedOf('next-bokeh'));
            ctx.save();
            ctx.filter = 'blur(5px)';
            for (let i = 0; i < 30; i++) {
                const col = [A, 0xff3a6a, 0x22e4ff, 0xfff1e0][Math.floor(r() * 4)];
                ctx.fillStyle = css(col, 0.18 + r() * 0.3);
                ctx.beginPath();
                dot(ctx, r() * w, r() * h * 0.62, 6 + r() * 18);
                ctx.fill();
            }
            ctx.restore();
            ctx.strokeStyle = css(0xffffff, 0.14);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < 70; i++) {
                const x = r() * (w + 60);
                const y = r() * h;
                const l = 10 + r() * 24;
                ctx.moveTo(x, y);
                ctx.lineTo(x - l * 0.25, y + l);
            }
            ctx.stroke();
            const sy0 = 104;
            const sy1 = 262;
            const top = w * 0.64;
            const bot = w * 0.88;
            glowAt(ctx, w / 2, (sy0 + sy1) / 2, w * 0.8, A, 0.42);
            // The car's roof, wet, catching the sign.
            ctx.fillStyle = css(0x0b0a07);
            ctx.beginPath();
            ctx.moveTo(-20, h * 0.8);
            ctx.quadraticCurveTo(w / 2, sy1 - 8, w + 20, h * 0.8);
            ctx.lineTo(w + 20, h);
            ctx.lineTo(-20, h);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = css(A, 0.75);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-20, h * 0.8);
            ctx.quadraticCurveTo(w / 2, sy1 - 8, w + 20, h * 0.8);
            ctx.stroke();
            glowAt(ctx, w / 2, sy1 + 30, w * 0.4, A, 0.28);
            ctx.fillStyle = css(0x1c1a12);
            ctx.fillRect(w / 2 - bot * 0.32, sy1, bot * 0.64, 18);
            const sign = new Path2D();
            sign.moveTo(w / 2 - top / 2 + 10, sy0);
            sign.lineTo(w / 2 + top / 2 - 10, sy0);
            sign.quadraticCurveTo(w / 2 + top / 2, sy0, w / 2 + top / 2 + 2, sy0 + 10);
            sign.lineTo(w / 2 + bot / 2, sy1);
            sign.lineTo(w / 2 - bot / 2, sy1);
            sign.lineTo(w / 2 - top / 2 - 2, sy0 + 10);
            sign.quadraticCurveTo(w / 2 - top / 2, sy0, w / 2 - top / 2 + 10, sy0);
            sign.closePath();
            ctx.save();
            ctx.shadowColor = css(A);
            ctx.shadowBlur = 34;
            const g = ctx.createLinearGradient(0, sy0, 0, sy1);
            g.addColorStop(0, css(light(A, 0.45)));
            g.addColorStop(1, css(A));
            ctx.fillStyle = g;
            ctx.fill(sign);
            ctx.restore();
            ctx.strokeStyle = css(dark(A, 0.45));
            ctx.lineWidth = 3;
            ctx.stroke(sign);
            block(ctx, [
                {
                    str: 'NEXT',
                    s: {
                        family: ORB, weight: 900, size: 96, color: css(B), maxW: top - 16,
                    },
                },
                {
                    str: 'TAXI',
                    gap: 12,
                    s: {
                        family: ORB, weight: 900, size: 17, spacing: 0.6, color: css(B),
                    },
                },
            ], w / 2, 0, { align: 'center', middle: (sy0 + sy1) / 2 + 4 });
            block(ctx, [
                {
                    str: 'ALWAYS ONE',
                    s: {
                        family: ORB, weight: 700, size: 19, spacing: 0.1, color: css(A),
                    },
                },
                {
                    str: 'MORE COMING',
                    gap: 10,
                    s: {
                        family: ORB, weight: 700, size: 19, spacing: 0.1, color: css(A),
                    },
                },
            ], w / 2, h * 0.79, { align: 'center' });
            fine(ctx, 'HAIL ANY CORNER', w / 2, h - 14, css(A, 0.6), 'center');
        },
        clear(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            const K = 0x061620;
            ground(ctx, w, h, light(B, 0.6), B);
            ctx.strokeStyle = css(K, 0.75);
            ctx.lineWidth = 1.5;
            ctx.strokeRect(12.5, 12.5, w - 25, h - 25);
            mark(ctx, 'clear', w / 2, 46, 70, [dark(A, 0.55), A]);
            const base = sized(ctx, 'CLEAR', {
                family: MAN, weight: 800, size: 120, spacing: 0.22, maxW: w - 70,
            }).size;
            const rows = [
                ['CLEAR', 1, '20/200'],
                ['OPTICS', 0.6, '20/100'],
                ['SEE EVERY', 0.4, '20/50'],
                ['LINE', 0.4, '20/40'],
                ['EYE TESTS · FRAMES', 0.22, '20/25'],
                ['LENSES · SAME DAY', 0.16, '20/20'],
            ];
            let y = 92;
            rows.forEach(([str, k, acuity], i) => {
                const s = {
                    family: MAN,
                    weight: 800,
                    size: base * k,
                    spacing: 0.22,
                    color: css(K),
                    align: 'center',
                    maxW: w - 70,
                };
                const cap = capOf(ctx, sized(ctx, str, s));
                y += cap;
                line(ctx, str, w / 2, y, s);
                line(ctx, String(i + 1), 22, y, {
                    family: MONO, weight: 400, size: 8, color: css(K, 0.5),
                });
                line(ctx, acuity, w - 22, y, {
                    family: MONO, weight: 400, size: 8, color: css(K, 0.5), align: 'right',
                });
                if (i === 1) {
                    ctx.fillStyle = css(A);
                    ctx.fillRect(40, y + 9, w - 80, 2);
                }
                y += Math.max(10, cap * 0.5) + (i === 1 ? 10 : 0);
            });
            // The red/green test strip, with rings to read on it.
            const by = h - 92;
            const bh = 52;
            ctx.fillStyle = css(0xd9303c);
            ctx.fillRect(24, by, (w - 48) / 2, bh);
            ctx.fillStyle = css(0x23a456);
            ctx.fillRect(w / 2, by, (w - 48) / 2, bh);
            ctx.strokeStyle = css(K);
            ctx.lineWidth = 4;
            [0, 1, 2, 3, 4, 5].forEach((i) => {
                const cx = 24 + ((w - 48) * (i + 0.5)) / 6;
                const gapAt = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, Math.PI][i];
                ctx.beginPath();
                ctx.arc(cx, by + bh / 2, 9, gapAt + 0.45, gapAt + TAU - 0.45);
                ctx.stroke();
            });
            fine(ctx, 'SEE EVERY LINE', w / 2, h - 22, css(K, 0.75), 'center');
        },
        spin(ctx, w, h, b) {
            const A = b.a;
            const B = b.b;
            ground(ctx, w, h, 0x150a2e, 0x07040f);
            const r = rng(seedOf('spin-doors'));
            const cell = w / 3;
            const rr = cell * 0.37;
            for (let row = 0; row * cell * 0.9 < h + cell; row++) {
                for (let col = -1; col < 4; col++) {
                    const cx = cell * (col + 0.5) + (row % 2 ? cell / 2 : 0);
                    const cy = 30 + row * cell * 0.9;
                    ctx.strokeStyle = css(light(A, 0.25), 0.7);
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    dot(ctx, cx, cy, rr);
                    ctx.stroke();
                    ctx.strokeStyle = css(B, 0.22);
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    dot(ctx, cx, cy, rr + 6);
                    ctx.stroke();
                    ctx.fillStyle = css(B, 0.07);
                    ctx.beginPath();
                    dot(ctx, cx, cy, rr - 6);
                    ctx.fill();
                    ctx.strokeStyle = css(B, 0.42);
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    const rot = r() * TAU;
                    for (let i = 0; i <= 40; i++) {
                        const t = i / 40;
                        const ang = rot + t * Math.PI * 2.6;
                        const rad = 3 + t * (rr - 12);
                        const px = cx + Math.cos(ang) * rad;
                        const py = cy + Math.sin(ang) * rad;
                        if (i) ctx.lineTo(px, py);
                        else ctx.moveTo(px, py);
                    }
                    ctx.stroke();
                }
            }
            const by = h * 0.36;
            const bh = 156;
            ctx.save();
            ctx.shadowColor = css(A);
            ctx.shadowBlur = 30;
            ctx.fillStyle = css(A);
            ctx.fillRect(0, by, w, bh);
            ctx.restore();
            ctx.fillStyle = css(B);
            ctx.fillRect(0, by + 6, w, 2);
            ctx.fillRect(0, by + bh - 8, w, 2);
            block(ctx, [
                {
                    str: 'SPIN',
                    s: {
                        family: UNB, weight: 800, size: 80, color: css(0xffffff), maxW: w - 40,
                    },
                },
                {
                    str: 'CYCLE',
                    gap: 10,
                    s: {
                        family: UNB, weight: 800, size: 34, spacing: 0.2, color: css(dark(A, 0.3)), maxW: w - 40,
                    },
                },
            ], w / 2, 0, { align: 'center', middle: by + bh / 2 });
            const f = ctx.createLinearGradient(0, h - 130, 0, h);
            f.addColorStop(0, 'rgba(7,4,15,0)');
            f.addColorStop(0.4, 'rgba(7,4,15,0.9)');
            f.addColorStop(1, 'rgba(7,4,15,1)');
            ctx.fillStyle = f;
            ctx.fillRect(0, h - 130, w, 130);
            line(ctx, 'WASH · DRY · FOLD', w / 2, h - 46, {
                family: MAN, weight: 800, size: 18, spacing: 0.3, color: css(0xffffff), align: 'center', maxW: w - 40,
            });
            fine(ctx, 'SELF SERVICE · OPEN 24H', w / 2, h - 16, css(B, 0.6), 'center');
        },
    };

    // ---- Serenity Transit ------------------------------------------------------------------
    const CREAM = 0xf2e6c8;
    function roundel(ctx, T, x, y, size) {
        mark(ctx, 'transit', x, y, size, [INK, T.a, T.b]);
    }
    function transitHeader(ctx, T, x, y, size, accent, right) {
        roundel(ctx, T, x + size / 2, y, size);
        line(ctx, 'SERENITY TRANSIT', x + size + 8, y + 4.5, {
            family: MONO, weight: 700, size: 12, spacing: 0.1, color: css(T.a),
        });
        if (right) {
            line(ctx, 'NOW BOARDING', right, y + 4.5, {
                family: MONO, weight: 700, size: 11, spacing: 0.1, color: css(accent), align: 'right',
            });
        }
    }
    function route(ctx, x0, x1, y, stops, accent, cream, at = -1) {
        ctx.fillStyle = css(accent);
        ctx.beginPath();
        ctx.roundRect(x0, y - 3, x1 - x0, 6, 3);
        ctx.fill();
        for (let i = 0; i < stops; i++) {
            const x = x0 + ((x1 - x0) * (i + 0.5)) / stops;
            ctx.fillStyle = css(INK);
            ctx.beginPath();
            dot(ctx, x, y, 8);
            ctx.fill();
            ctx.fillStyle = css(i === at ? accent : cream);
            ctx.beginPath();
            dot(ctx, x, y, 5);
            ctx.fill();
            if (i === at) {
                ctx.strokeStyle = css(cream);
                ctx.lineWidth = 2;
                ctx.beginPath();
                dot(ctx, x, y, 11.5);
                ctx.stroke();
            }
        }
    }
    /** One size for every line: the largest at which the longest still fits `s.maxW`. */
    function fitAll(ctx, strs, s) {
        const size = Math.min(...strs.map((str) => sized(ctx, str, s).size));
        return { ...s, size, maxW: undefined };
    }
    /** Greedy word wrap of `str` into lines no wider than `maxW`. */
    function wrap(ctx, str, s, maxW) {
        const out = [];
        let cur = '';
        for (const wd of str.split(' ')) {
            const next = cur ? `${cur} ${wd}` : wd;
            if (cur && widthOf(ctx, next, s) > maxW) {
                out.push(cur);
                cur = wd;
            } else {
                cur = next;
            }
        }
        if (cur) out.push(cur);
        return out;
    }
    /**
     * Sets `str` round a circle, clockwise and centred on the top, each letter upright to the
     * centre. `fill` spreads the letters so the text closes the whole ring.
     */
    function circleText(ctx, str, cx, cy, r, s, fill = false) {
        setFont(ctx, s);
        const chars = [...str];
        const widths = chars.map((ch) => ctx.measureText(ch).width);
        const raw = widths.reduce((a, v) => a + v, 0);
        const track = fill ? (TAU * r - raw) / chars.length : (s.spacing || 0) * s.size;
        const total = raw + track * chars.length;
        let a = -Math.PI / 2 - total / r / 2;
        ctx.save();
        ctx.fillStyle = s.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        chars.forEach((ch, i) => {
            const adv = widths[i] + track;
            const mid = a + adv / 2 / r;
            ctx.save();
            ctx.translate(cx + Math.cos(mid) * r, cy + Math.sin(mid) * r);
            ctx.rotate(mid + Math.PI / 2);
            ctx.fillText(ch, 0, 0);
            ctx.restore();
            a += adv / r;
        });
        ctx.restore();
    }
    const lineNo = (p) => String(p.n).padStart(2, '0');

    /**
     * The seven travel-poster designs. Each gets the poster (name, line, n = its line number), its
     * picture ({ img, region, focus }) and the colours sampled from that picture; every one keeps
     * the line's roundel (the route with three stops) so they read as one campaign.
     */
    const POSTER_DESIGNS = {
        /** The line's classic: a framed print on ink, the name under it, the route at the foot. */
        vintage(ctx, w, h, T, p, im, C) {
            const { accent } = C;
            ground(ctx, w, h, mix(C.deep, INK, 0.35), C.ink);
            ctx.strokeStyle = css(CREAM, 0.22);
            ctx.lineWidth = 1;
            ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
            const m = 12;
            transitHeader(ctx, T, m, 21, 20, accent, w - m);
            const fx = m;
            const fy = 38;
            const fw = w - m * 2;
            // Laid out from the foot up, so every poster keeps one rhythm whatever its name's length.
            const words = p.name.split(' ');
            const name = fitAll(ctx, words, {
                family: UNB, weight: 800, size: words.length > 1 ? 42 : 52, spacing: 0.02, color: css(CREAM), maxW: fw,
            });
            const cap = capOf(ctx, name);
            const strapBase = h - 46;
            const nameH = words.length * cap + (words.length - 1) * 8;
            const nameTop = strapBase - 24 - nameH;
            const fh = Math.round(nameTop - 18 - fy);
            ctx.fillStyle = css(CREAM);
            ctx.fillRect(fx, fy, fw, fh);
            place(ctx, im, fx + 5, fy + 5, fw - 10, fh - 10);
            const shade = ctx.createLinearGradient(0, fy + fh * 0.62, 0, fy + fh);
            shade.addColorStop(0, 'rgba(6,8,16,0)');
            shade.addColorStop(1, 'rgba(6,8,16,0.5)');
            ctx.fillStyle = shade;
            ctx.fillRect(fx + 5, fy + 5, fw - 10, fh - 10);
            block(ctx, words.map((str) => ({ str, gap: 8, s: name })), m, nameTop);
            line(ctx, p.line, m, strapBase, {
                family: MAN, weight: 800, size: 14, spacing: 0.16, color: css(accent), maxW: fw,
            });
            route(ctx, m + 2, w - m - 2, h - 20, 3, accent, CREAM, 1);
        },
        /** Full bleed, the name running up the left side. */
        side(ctx, w, h, T, p, im, C) {
            place(ctx, im, 0, 0, w, h);
            const words = p.name.split(' ');
            const top = 22;
            const bottom = h - 20;
            let s = fitAll(ctx, words, {
                family: ORB, weight: 900, size: 140, spacing: 0.03, color: css(CREAM), maxW: bottom - top,
            });
            let cap = capOf(ctx, s);
            const colsW = (k) => words.length * k + (words.length - 1) * k * 0.22;
            if (colsW(cap) > w * 0.6) {
                s = { ...s, size: (s.size * w * 0.6) / colsW(cap) };
                cap = capOf(ctx, s);
            }
            const gap = cap * 0.22;
            const left = 17;
            const titleRight = left + colsW(cap);
            const g = ctx.createLinearGradient(0, 0, titleRight + 80, 0);
            g.addColorStop(0, css(C.ink, 0.88));
            g.addColorStop(0.6, css(C.ink, 0.55));
            g.addColorStop(1, css(C.ink, 0));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, titleRight + 80, h);
            const foot = ctx.createLinearGradient(0, h * 0.6, 0, h);
            foot.addColorStop(0, css(C.ink, 0));
            foot.addColorStop(1, css(C.ink, 0.8));
            ctx.fillStyle = foot;
            ctx.fillRect(0, h * 0.6, w, h * 0.4);
            const head = ctx.createLinearGradient(0, 0, 0, 64);
            head.addColorStop(0, css(C.ink, 0.6));
            head.addColorStop(1, css(C.ink, 0));
            ctx.fillStyle = head;
            ctx.fillRect(0, 0, w, 64);
            ctx.fillStyle = css(C.accent);
            ctx.fillRect(0, 0, 5, h);
            words.forEach((wd, i) => {
                const bx = left + cap * (i + 1) + gap * i;
                ctx.save();
                ctx.translate(bx, bottom);
                ctx.rotate(-Math.PI / 2);
                line(ctx, wd, 0, 0, { ...s, glow: 14, glowColor: css(C.ink, 0.9) });
                ctx.restore();
            });
            roundel(ctx, T, w - 22, 24, 20);
            line(ctx, 'SERENITY', w - 38, 22.5, {
                family: MONO, weight: 700, size: 10, spacing: 0.1, color: css(CREAM), align: 'right',
            });
            line(ctx, 'TRANSIT', w - 38, 34, {
                family: MONO, weight: 700, size: 10, spacing: 0.1, color: css(CREAM), align: 'right',
            });
            const strap = {
                family: MAN, weight: 800, size: 14, spacing: 0.12, color: css(C.accent),
            };
            const lines = wrap(ctx, p.line, strap, w - titleRight - 30);
            let y = h - 44 - (lines.length - 1) * 19;
            for (const str of lines) {
                line(ctx, str, w - 14, y, { ...strap, align: 'right', maxW: w - titleRight - 30 });
                y += 19;
            }
            line(ctx, 'NOW BOARDING', w - 14, h - 20, {
                family: MONO, weight: 700, size: 10, spacing: 0.12, color: css(CREAM, 0.85), align: 'right',
            });
        },
        /** International style: a flat colour field, an offset square picture, a strict grid. */
        swiss(ctx, w, h, T, p, im, C) {
            const bg = C.field;
            const text = lum(bg) > 0.3 ? C.ink : C.paper;
            ctx.fillStyle = css(bg);
            ctx.fillRect(0, 0, w, h);
            const m = 16;
            const num = lineNo(p);
            line(ctx, num, w - m + 6, 196, {
                family: MAN, weight: 800, size: 210, spacing: -0.06, color: css(mix(bg, text, 0.22)), align: 'right',
            });
            const small = {
                family: MAN, weight: 700, size: 12, color: css(text),
            };
            roundel(ctx, T, m + 9, 25, 18);
            line(ctx, 'serenity transit', m + 25, 29.5, small);
            line(ctx, `line ${num}`, w - m, 29.5, { ...small, align: 'right' });
            ctx.fillStyle = css(text);
            ctx.fillRect(m, 42, w - m * 2, 1.5);
            const ps = Math.round(w * 0.6);
            const py = 112;
            place(ctx, im, m, py, ps, ps);
            const colX = m + ps + 12;
            const colW = w - m - colX;
            const tiny = {
                family: MAN, weight: 600, size: 10.5, color: css(text),
            };
            let y = py + ps - 64;
            line(ctx, 'to', colX, y, { ...tiny, color: css(text, 0.6) });
            for (const str of wrap(ctx, p.line.toLowerCase(), tiny, colW)) {
                y += 14;
                line(ctx, str, colX, y, tiny);
            }
            const words = p.name.toLowerCase().split(' ');
            const s = fitAll(ctx, words, {
                family: MAN, weight: 800, size: 64, spacing: -0.03, color: css(text), maxW: w - m * 2,
            });
            const cap = capOf(ctx, s);
            const gap = cap * 0.28;
            const total = words.length * cap + (words.length - 1) * gap;
            block(ctx, words.map((str) => ({ str, gap, s })), m - 2, h - 58 - total);
            ctx.fillStyle = css(text);
            ctx.fillRect(m, h - 42, w - m * 2, 1.5);
            line(ctx, 'now boarding', m, h - 22, small);
            line(ctx, 'from neon district', w - m, h - 22, { ...small, align: 'right' });
        },
        /** Art deco: an arched window over sunburst rays, double gilt rules, centred tracked type. */
        deco(ctx, w, h, T, p, im, C) {
            const gold = mix(0xe6c67f, C.accent, 0.2);
            ground(ctx, w, h, C.deep, C.ink);
            const cx = w / 2;
            const r = 108;
            const archTop = 44;
            const archCy = archTop + r;
            const archBottom = 282;
            const fan = (c) => rays(c, w, h, cx, archCy, 56, gold, 0.18, 0.03);
            masked(ctx, w, h, fan, radialMask(cx, archCy, r * 0.9, h * 0.66));
            const arch = (k) => {
                const a = new Path2D();
                a.moveTo(cx - r - k, archBottom + k);
                a.lineTo(cx - r - k, archCy);
                a.arc(cx, archCy, r + k, Math.PI, 0);
                a.lineTo(cx + r + k, archBottom + k);
                a.closePath();
                return a;
            };
            ctx.save();
            ctx.clip(arch(0));
            place(ctx, im, cx - r, archTop, r * 2, archBottom - archTop);
            ctx.restore();
            ctx.strokeStyle = css(gold);
            ctx.lineWidth = 2.5;
            ctx.stroke(arch(0));
            ctx.lineWidth = 1;
            ctx.stroke(arch(7));
            ctx.fillStyle = css(gold);
            for (let k = 0; k < 3; k++) {
                const half = r + 12 + k * 10;
                ctx.fillRect(cx - half, archBottom + 12 + k * 5, half * 2, 1.6);
            }
            ctx.strokeStyle = css(gold);
            ctx.lineWidth = 1.6;
            ctx.strokeRect(9, 9, w - 18, h - 18);
            ctx.lineWidth = 0.8;
            ctx.strokeRect(14.5, 14.5, w - 29, h - 29);
            for (const [x, y] of [[14.5, 14.5], [w - 14.5, 14.5], [14.5, h - 14.5], [w - 14.5, h - 14.5]]) {
                ctx.beginPath();
                ctx.moveTo(x, y - 6);
                ctx.lineTo(x + 6, y);
                ctx.lineTo(x, y + 6);
                ctx.lineTo(x - 6, y);
                ctx.closePath();
                ctx.fill();
            }
            line(ctx, 'SERENITY TRANSIT', cx, 32, {
                family: MAN, weight: 700, size: 9, spacing: 0.5, color: css(gold), align: 'center',
            });
            const words = p.name.split(' ');
            const s = fitAll(ctx, words, {
                family: UNB, weight: 600, size: 44, spacing: 0.15, color: css(CREAM), maxW: w - 64,
            });
            const lines = words.map((str) => ({ str, gap: 10, s }));
            const boxes = block(ctx, lines, cx, archBottom + 40, { align: 'center' });
            let y = boxes[boxes.length - 1].base + 16;
            ctx.fillStyle = css(gold);
            ctx.fillRect(cx - 52, y, 40, 1);
            ctx.fillRect(cx + 12, y, 40, 1);
            ctx.beginPath();
            ctx.moveTo(cx, y - 4);
            ctx.lineTo(cx + 4, y + 0.5);
            ctx.lineTo(cx, y + 5);
            ctx.lineTo(cx - 4, y + 0.5);
            ctx.closePath();
            ctx.fill();
            const strap = {
                family: MAN, weight: 700, size: 10, spacing: 0.3, color: css(gold),
            };
            for (const str of wrap(ctx, p.line, strap, w - 70)) {
                y += 17;
                line(ctx, str, cx, y, { ...strap, align: 'center' });
            }
            roundel(ctx, T, cx, h - 32, 16);
            ctx.fillStyle = css(gold);
            ctx.fillRect(cx - 70, h - 32.5, 52, 1);
            ctx.fillRect(cx + 18, h - 32.5, 52, 1);
        },
        /** Two inks: the picture posterised onto the world's colours, the name knocked out of a block. */
        duotone(ctx, w, h, T, p, im, C) {
            const darkInk = hsv(C.shadeHue, 0.8, 0.13);
            const midInk = hsv(C.shadeHue, 0.78, 0.72);
            const highInk = hsv(C.lightHue, C.mono ? 0.16 : 0.28, 1);
            const layer = document.createElement('canvas');
            layer.width = w;
            layer.height = h;
            const lc = layer.getContext('2d', { willReadFrequently: true });
            lc.imageSmoothingQuality = 'high';
            // Softened first, so the tone bands come out as clean screen-print shapes, not pixel steps.
            lc.filter = 'blur(2.6px)';
            place(lc, im, 0, 0, w, h);
            lc.filter = 'none';
            const img = lc.getImageData(0, 0, w, h);
            const d = img.data;
            const hist = new Uint32Array(256);
            for (let i = 0; i < d.length; i += 4) {
                hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])] += 1;
            }
            const pct = (q) => {
                let acc = 0;
                for (let k = 0; k < 256; k++) {
                    acc += hist[k];
                    if (acc >= q * w * h) return k;
                }
                return 255;
            };
            const lo = pct(0.04);
            const hi = Math.max(lo + 1, pct(0.97));
            const d0 = rgb(darkInk);
            const m0 = rgb(midInk);
            const h0 = rgb(highInk);
            const LEVELS = 5;
            for (let i = 0; i < d.length; i += 4) {
                const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
                const f = Math.min(1, Math.max(0, (l - lo) / (hi - lo))) * (LEVELS - 1);
                // Hard tone steps with a narrow soft edge, so band outlines stay smooth.
                const q = Math.min(1, Math.max(0, (f - Math.floor(f) - 0.38) / 0.24));
                const t = Math.min(1, (Math.floor(f) + q * q * (3 - 2 * q)) / (LEVELS - 1));
                const [a, bb, k] = t < 0.5 ? [d0, m0, t * 2] : [m0, h0, (t - 0.5) * 2];
                d[i] = a[0] + (bb[0] - a[0]) * k;
                d[i + 1] = a[1] + (bb[1] - a[1]) * k;
                d[i + 2] = a[2] + (bb[2] - a[2]) * k;
            }
            lc.putImageData(img, 0, 0);
            ctx.drawImage(layer, 0, 0);
            const words = p.name.split(' ');
            const s = fitAll(ctx, words, {
                family: UNB, weight: 900, size: 96, spacing: -0.01, color: '#000', maxW: w - 28,
            });
            const cap = capOf(ctx, s);
            const gap = cap * 0.2;
            const titleTop = 50;
            const bandH = titleTop + words.length * cap + (words.length - 1) * gap + 20;
            ctx.fillStyle = css(darkInk, 0.66);
            ctx.fillRect(0, 0, w, bandH);
            const blockCol = hsv(C.lightHue, C.mono ? 0.5 : 0.72, 1);
            const band = document.createElement('canvas');
            band.width = w;
            band.height = h;
            const bc = band.getContext('2d');
            bc.fillStyle = css(blockCol);
            bc.fillRect(0, 0, w, bandH);
            bc.globalCompositeOperation = 'destination-out';
            block(bc, words.map((str) => ({ str, gap, s })), 13, titleTop);
            bc.globalCompositeOperation = 'source-over';
            ctx.drawImage(band, 0, 0);
            roundel(ctx, T, 23, 24, 18);
            line(ctx, 'SERENITY TRANSIT', 39, 28.5, {
                family: MONO, weight: 700, size: 11, spacing: 0.06, color: css(darkInk),
            });
            line(ctx, `NO. ${lineNo(p)}`, w - 13, 28.5, {
                family: MONO, weight: 700, size: 11, spacing: 0.06, color: css(darkInk), align: 'right',
            });
            const foot = ctx.createLinearGradient(0, h - 120, 0, h);
            foot.addColorStop(0, css(darkInk, 0));
            foot.addColorStop(1, css(darkInk, 0.9));
            ctx.fillStyle = foot;
            ctx.fillRect(0, h - 120, w, 120);
            ctx.fillStyle = css(blockCol);
            ctx.fillRect(13, h - 62, 34, 4);
            line(ctx, p.line, 13, h - 36, {
                family: UNB, weight: 700, size: 13, spacing: 0.06, color: css(highInk), maxW: w - 26,
            });
            line(ctx, 'NOW BOARDING', 13, h - 17, {
                family: MONO, weight: 700, size: 10, spacing: 0.12, color: css(blockCol),
            });
        },
        /** A boarding pass: the picture on the card, the destination on a split-flap board, a stub. */
        ticket(ctx, w, h, T, p, im, C) {
            ground(ctx, w, h, C.deep, C.ink);
            stripes(ctx, 0, 0, w, h, {
                color: css(C.accent, 0.05), slant: 0.6, width: 6, period: 18,
            });
            const paper = 0xf3ead6;
            const K = 0x17161c;
            const markCol = C.accentDark;
            const x0 = 14;
            const y0 = 16;
            const cw = w - 28;
            const ch = h - 32;
            const perfY = y0 + ch - 92;
            const card = document.createElement('canvas');
            card.width = w;
            card.height = h;
            const k = card.getContext('2d');
            k.imageSmoothingQuality = 'high';
            k.fillStyle = css(paper);
            k.beginPath();
            k.roundRect(x0, y0, cw, ch, 12);
            k.fill();
            const ph = 140;
            k.save();
            k.beginPath();
            k.roundRect(x0, y0, cw, ph, [12, 12, 0, 0]);
            k.clip();
            place(k, im, x0, y0, cw, ph);
            k.fillStyle = css(K, 0.74);
            k.fillRect(x0, y0, cw, 26);
            k.restore();
            roundel(k, T, x0 + 15, y0 + 13, 15);
            line(k, 'SERENITY TRANSIT', x0 + 28, y0 + 17, {
                family: MONO, weight: 700, size: 10, spacing: 0.06, color: css(CREAM),
            });
            line(k, 'BOARDING PASS', x0 + cw - 10, y0 + 17, {
                family: MONO, weight: 700, size: 10, spacing: 0.06, color: css(C.accent), align: 'right',
            });
            const label = (str, x, y, align = 'left') => line(k, str, x, y, {
                family: MONO, weight: 400, size: 8.5, spacing: 0.12, color: css(K, 0.55), align,
            });
            const value = (str, x, y, align = 'left') => line(k, str, x, y, {
                family: MONO, weight: 700, size: 12, spacing: 0.02, color: css(K), align,
            });
            let y = y0 + ph + 20;
            label('FROM', x0 + 12, y);
            label('LINE', x0 + cw - 12, y, 'right');
            value('NEON DISTRICT', x0 + 12, y + 15);
            value(lineNo(p), x0 + cw - 12, y + 15, 'right');
            y += 36;
            label('TO', x0 + 12, y);
            y += 8;
            // The split-flap tiles as large as the card allows: the width of the longest word, and
            // the height left between the fields and the route above the perforation.
            // Like a real departure board, every row has the same number of flaps (at least six),
            // the ones past a short word left blank.
            const words = p.name.split(' ');
            const cols = Math.max(6, ...words.map((wd) => wd.length));
            const room = perfY - 62 - y;
            const byWidth = (cw - 24 - (cols - 1) * 3) / cols;
            const byHeight = (room - (words.length - 1) * 5) / words.length / 1.36;
            const tw = Math.min(42, byWidth, byHeight);
            const th = Math.round(tw * 1.36);
            y += Math.max(0, (room - words.length * th - (words.length - 1) * 5) * 0.35);
            for (const wd of words) {
                for (let j = 0; j < cols; j++) {
                    const chr = wd[j];
                    const tx = x0 + 12 + j * (tw + 3);
                    k.fillStyle = css(chr ? K : mix(K, paper, 0.3));
                    k.beginPath();
                    k.roundRect(tx, y, tw, th, 3);
                    k.fill();
                    if (chr) {
                        line(k, chr, tx + tw / 2, y + th / 2 + th * 0.25, {
                            family: MONO, weight: 700, size: th * 0.7, color: css(CREAM), align: 'center',
                        });
                    }
                    k.fillStyle = css(paper, 0.32);
                    k.fillRect(tx, y + th / 2 - 0.5, tw, 1);
                }
                y += th + 5;
            }
            y = Math.max(y + 16, perfY - 44);
            route(k, x0 + 14, x0 + cw - 14, y, 3, markCol, paper, 2);
            label('NEON DISTRICT', x0 + 14, y + 22);
            label(p.line, x0 + cw - 14, y + 22, 'right');
            k.globalCompositeOperation = 'destination-out';
            k.beginPath();
            dot(k, x0, perfY, 9);
            dot(k, x0 + cw, perfY, 9);
            k.fill();
            k.globalCompositeOperation = 'source-over';
            k.fillStyle = css(K, 0.35);
            for (let x = x0 + 14; x < x0 + cw - 14; x += 8) k.fillRect(x, perfY - 0.5, 4, 1);
            label('PLATFORM', x0 + 12, perfY + 22);
            line(k, String(((p.n - 1) % 9) + 1), x0 + 12, perfY + 66, {
                family: MONO, weight: 700, size: 46, color: css(markCol),
            });
            barcode(k, x0 + cw - 156, perfY + 16, 142, 34, seedOf(p.id), css(K));
            label('ADMIT ONE · ONE WAY', x0 + cw - 14, perfY + 66, 'right');
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 4;
            ctx.drawImage(card, 0, 0);
            ctx.restore();
        },
        /** A porthole: the picture through round glass in a brass ring, the line's name round it. */
        porthole(ctx, w, h, T, p, im, C) {
            ground(ctx, w, h, C.deep, C.ink);
            glowAt(ctx, w / 2, h * 0.62, w * 0.75, C.vivid, 0.14);
            const words = p.name.split(' ');
            const s = fitAll(ctx, words, {
                family: ORB, weight: 900, size: 60, spacing: 0.04, color: css(CREAM), maxW: w - 34,
            });
            const boxes = block(ctx, words.map((str) => ({ str, gap: 10, s })), w / 2, 28, { align: 'center' });
            const titleBottom = boxes[boxes.length - 1].base;
            line(ctx, p.line, w / 2, titleBottom + 22, {
                family: MAN, weight: 800, size: 12, spacing: 0.16, color: css(C.accent), align: 'center', maxW: w - 34,
            });
            const top = titleBottom + 38;
            const bottom = h - 42;
            const R = Math.min((bottom - top) / 2, w / 2 - 12);
            const cx = w / 2;
            const cy = top + (bottom - top) / 2;
            const r = R - 24;
            ctx.save();
            ctx.beginPath();
            dot(ctx, cx, cy, r);
            ctx.clip();
            place(ctx, im, cx - r, cy - r, r * 2, r * 2);
            const inner = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
            inner.addColorStop(0, 'rgba(0,0,0,0)');
            inner.addColorStop(1, 'rgba(0,0,0,0.55)');
            ctx.fillStyle = inner;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.82, Math.PI * 1.1, Math.PI * 1.38);
            ctx.stroke();
            ctx.restore();
            const brass = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
            brass.addColorStop(0, css(light(C.accent, 0.55)));
            brass.addColorStop(0.5, css(dark(C.accent, 0.42)));
            brass.addColorStop(1, css(light(C.accent, 0.3)));
            ctx.strokeStyle = brass;
            ctx.lineWidth = 10;
            ctx.beginPath();
            dot(ctx, cx, cy, r + 5);
            ctx.stroke();
            ctx.fillStyle = css(C.ink, 0.85);
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * TAU;
                ctx.beginPath();
                dot(ctx, cx + Math.cos(a) * (r + 5), cy + Math.sin(a) * (r + 5), 1.7);
                ctx.fill();
            }
            ctx.strokeStyle = css(C.accent, 0.8);
            ctx.lineWidth = 1;
            ctx.beginPath();
            dot(ctx, cx, cy, r + 11.5);
            ctx.stroke();
            ctx.beginPath();
            dot(ctx, cx, cy, R);
            ctx.stroke();
            const ring = `SERENITY TRANSIT · LINE ${lineNo(p)} · NOW BOARDING · `;
            const ringS = {
                family: MONO, weight: 700, size: 9, color: css(CREAM),
            };
            const circ = TAU * (r + 18);
            const reps = Math.max(1, Math.floor(circ / (widthOf(ctx, ring, ringS) * 1.12)));
            circleText(ctx, ring.repeat(reps), cx, cy, r + 18, ringS, true);
            roundel(ctx, T, w / 2, h - 20, 16);
        },
    };

    /** The three mode billboards, each in its own design. */
    function paintMode(ctx, w, h, T, p, imgs) {
        const { accent } = p;
        ground(ctx, w, h, 0x0d1020, INK);
        if (p.layout === 'marquee') {
            // A theatre marquee: the picture full bleed, framed in a ring of bulbs, the name centred.
            place(ctx, imgs[0], 0, 0, w, h);
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, css(INK, 0.35));
            g.addColorStop(0.5, css(INK, 0.5));
            g.addColorStop(1, css(INK, 0.82));
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = css(CREAM, 0.9);
            ctx.lineWidth = 2;
            ctx.strokeRect(13, 13, w - 26, h - 26);
            ctx.lineWidth = 1;
            ctx.strokeRect(25.5, 25.5, w - 51, h - 51);
            ctx.save();
            ctx.shadowColor = css(accent);
            ctx.shadowBlur = 8;
            ctx.fillStyle = css(light(accent, 0.55));
            const bulbs = (x0, y0, x1, y1) => {
                const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 17);
                for (let i = 0; i <= n; i++) {
                    ctx.beginPath();
                    dot(ctx, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 2.4);
                    ctx.fill();
                }
            };
            bulbs(19.5, 19.5, w - 19.5, 19.5);
            bulbs(19.5, h - 19.5, w - 19.5, h - 19.5);
            bulbs(19.5, 19.5, 19.5, h - 19.5);
            bulbs(w - 19.5, 19.5, w - 19.5, h - 19.5);
            ctx.restore();
            roundel(ctx, T, w / 2 - 78, 52, 18);
            line(ctx, 'SERENITY TRANSIT', w / 2 - 62, 56.5, {
                family: MONO, weight: 700, size: 12, spacing: 0.14, color: css(CREAM),
            });
            block(ctx, [
                {
                    str: p.name,
                    s: {
                        family: ORB,
                        weight: 900,
                        size: 78,
                        spacing: 0.06,
                        color: css(CREAM),
                        maxW: w - 120,
                        glow: 18,
                        glowColor: css(accent),
                    },
                },
                {
                    str: p.line,
                    gap: 18,
                    s: {
                        family: MAN, weight: 800, size: 18, spacing: 0.14, color: css(accent), maxW: w - 120,
                    },
                },
                {
                    str: p.sub,
                    gap: 10,
                    s: {
                        family: MAN, weight: 600, size: 13, spacing: 0.18, color: css(CREAM, 0.85), maxW: w - 120,
                    },
                },
            ], w / 2, 0, { align: 'center', middle: h * 0.53 });
            route(ctx, w / 2 - 90, w / 2 + 90, h - 46, p.stops, accent, CREAM, 0);
            return;
        }
        if (imgs.length === 1) {
            // One picture on the right, fading into the ink behind the words.
            const ix = Math.round(w * 0.38);
            place(ctx, imgs[0], ix, 0, w - ix, h);
            const fade = ctx.createLinearGradient(ix, 0, ix + 150, 0);
            fade.addColorStop(0, css(INK, 1));
            fade.addColorStop(1, css(INK, 0));
            ctx.fillStyle = fade;
            ctx.fillRect(ix, 0, 150, h);
        } else {
            // A journey, from one picture to the other across the whole board; the words sit on the
            // first (the wider one), clear of the seam.
            const split = Math.round(w * 0.6);
            place(ctx, imgs[0], 0, 0, split, h);
            place(ctx, imgs[1], split, 0, w - split, h);
            const fade = ctx.createLinearGradient(0, 0, split, 0);
            fade.addColorStop(0, css(INK, 0.92));
            fade.addColorStop(0.6, css(INK, 0.66));
            fade.addColorStop(1, css(INK, 0.2));
            ctx.fillStyle = fade;
            ctx.fillRect(0, 0, split, h);
            ctx.fillStyle = css(CREAM, 0.85);
            ctx.fillRect(split - 1, 0, 2, h);
        }
        const x = 26;
        transitHeader(ctx, T, x, 34, 24, accent);
        const journey = p.layout === 'journey';
        // The journey's name is set light and wide-tracked; the classic's heavy.
        const nameType = {
            family: UNB,
            weight: journey ? 300 : 800,
            size: journey ? 54 : 60,
            spacing: journey ? 0.22 : 0,
            color: css(CREAM),
            maxW: w * 0.54,
            glow: 10,
            glowColor: css(INK),
        };
        const boxes = block(ctx, [
            { str: p.name, s: nameType },
            {
                str: p.line,
                gap: 20,
                s: {
                    family: MAN, weight: 800, size: 20, spacing: 0.1, color: css(accent), maxW: w * 0.54,
                },
            },
            {
                str: p.sub,
                gap: 12,
                s: {
                    family: MAN, weight: 600, size: 14, spacing: 0.14, color: css(CREAM, 0.85), maxW: w * 0.5,
                },
            },
        ], x, 0, { middle: h * (journey ? 0.47 : 0.52) });
        if (journey) {
            // The route runs the whole board, from the core to the hole, across the seam.
            const ry = h - 40;
            ctx.fillStyle = css(INK, 0.6);
            ctx.fillRect(0, ry - 22, w, 56);
            route(ctx, x, w - x, ry, p.stops, accent, CREAM, 0);
            const tag = {
                family: MONO, weight: 700, size: 10, spacing: 0.1, color: css(CREAM),
            };
            const stopX = (i) => x + ((w - 2 * x) * (i + 0.5)) / p.stops;
            line(ctx, 'EARTH\'S CORE', stopX(0), ry + 24, { ...tag, align: 'center' });
            line(ctx, 'BLACK HOLE', stopX(p.stops - 1), ry + 24, { ...tag, align: 'center' });
            return;
        }
        route(ctx, x, x + Math.min(w * 0.44, boxes[0].w), h - 30, p.stops, accent, CREAM, 0);
        line(ctx, 'NOW BOARDING', w - 18, h - 18, {
            family: MONO,
            weight: 700,
            size: 12,
            spacing: 0.12,
            color: css(CREAM),
            align: 'right',
            bg: {
                color: css(INK, 0.75), padX: 8, padY: 6, radius: 4,
            },
        });
    }

    async function paint(spec, shape, w, h, load) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        const wide = shape === 'wide';
        const variant = spec.variant > 1 ? `-${spec.variant}` : '';
        const id = `${spec.kind}-${spec.brand.id}-${spec.poster ? spec.poster.id : ''}-${shape}${variant}`;
        if (spec.kind === 'brand') {
            if (spec.variant > 1) BRAND_POSTERS_2[spec.brand.id](ctx, w, h, spec.brand);
            else BRAND_PAINTERS[spec.brand.id](ctx, w, h, spec.brand, wide);
            vignette(ctx, w, h, 0.35);
        } else if (spec.kind === 'hale') {
            paintHale(ctx, w, h, spec.brand, wide, spec.ring);
        } else {
            const imgs = [];
            for (const im of spec.images) {
                imgs.push({
                    img: await load(im.url), region: im.region, focus: im.focus, zoom: im.zoom,
                });
            }
            if (spec.kind === 'world') {
                const colours = coloursOf(paletteOf(imgs[0]));
                POSTER_DESIGNS[spec.poster.layout](ctx, w, h, spec.brand, spec.poster, imgs[0], colours);
            } else {
                paintMode(ctx, w, h, spec.brand, spec.poster, imgs);
            }
        }
        grain(ctx, w, h, seedOf(id), spec.kind === 'world' ? 10 : 6);
        return canvas;
    }

    window.__campaignArt = { paint };
    return true;
}

/** Runs in the page: draws one atlas and returns { full, half, cells }. */
async function bakeInPage(spec, gutter) {
    const load = (url) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#04030a';
    ctx.fillRect(0, 0, spec.width, spec.height);
    ctx.imageSmoothingQuality = 'high';
    const probe = document.createElement('canvas');
    probe.width = 48;
    probe.height = 48;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.imageSmoothingQuality = 'high';
    const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const cells = [];
    for (const cell of spec.cells) {
        const img = cell.paint
            ? await window.__campaignArt.paint(cell.paint, cell.shape, cell.w - gutter * 2, cell.h - gutter * 2, load)
            : await load(cell.url);
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const aspect = iw / ih;
        // Fit inside the cell minus its gutter, keeping the piece's own aspect.
        const maxW = cell.w - gutter * 2;
        const maxH = cell.h - gutter * 2;
        let w = maxW;
        let h = w / aspect;
        if (h > maxH) {
            h = maxH;
            w = h * aspect;
        }
        w = Math.round(w);
        h = Math.round(h);
        const x = cell.x + Math.round((cell.w - w) / 2);
        const y = cell.y + Math.round((cell.h - h) / 2);
        // Edge extension: the piece drawn `gutter` px larger first, so mips never bleed black.
        ctx.drawImage(img, x - gutter, y - gutter, w + gutter * 2, h + gutter * 2);
        ctx.drawImage(img, x, y, w, h);
        pctx.clearRect(0, 0, 48, 48);
        pctx.drawImage(img, 0, 0, 48, 48);
        const px = pctx.getImageData(0, 0, 48, 48).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        let luma = 0;
        for (let i = 0; i < px.length; i += 4) {
            const lr = toLinear(px[i] / 255);
            const lg = toLinear(px[i + 1] / 255);
            const lb = toLinear(px[i + 2] / 255);
            const l = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
            const k = l * l + 1e-5;
            r += lr * k;
            g += lg * k;
            b += lb * k;
            weight += k;
            luma += l;
        }
        r /= weight;
        g /= weight;
        b /= weight;
        const peak = Math.max(r, g, b, 1e-4);
        const meta = {};
        for (const key of ['id', 'family', 'brand', 'shape', 'motion', 'ring']) {
            if (key in cell) meta[key] = cell[key];
        }
        cells.push({
            ...meta,
            src: cell.src,
            rect: [x / spec.width, y / spec.height, (x + w) / spec.width, (y + h) / spec.height],
            aspect: w / h,
            glow: [r / peak, g / peak, b / peak],
            luma: luma / (px.length / 4),
        });
    }
    const half = document.createElement('canvas');
    half.width = Math.round(spec.width / 2);
    half.height = Math.round(spec.height / 2);
    const hctx = half.getContext('2d');
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(canvas, 0, 0, half.width, half.height);
    return {
        full: canvas.toDataURL('image/webp', 0.9),
        half: half.toDataURL('image/webp', 0.86),
        cells,
    };
}

const round = (v, digits = 5) => Number(v.toFixed(digits));
const str = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
const rectOf = (c) => `rect: [${c.rect.map((v) => round(v)).join(', ')}],`;
const glowOf = (c) => `glow: [${c.glow.map((v) => round(v, 3)).join(', ')}],`;

function tableSource(shop, ads, adsAtlas) {
    const shopRows = shop.cells.map((c) => `    {
        src: '${c.src}',
        ${rectOf(c)}
        aspect: ${round(c.aspect, 4)},
        ${glowOf(c)}
        luma: ${round(c.luma, 4)},
    },`).join('\n');
    const adRows = ads.cells.map((c) => `    {
        id: '${c.id}',
        family: '${c.family}',
        brand: ${str(c.brand)},
        shape: '${c.shape}',
        motion: '${c.motion}',
        ring: ${c.ring ? `[${c.ring.join(', ')}]` : 'null'},
        src: ${str(c.src)},
        ${rectOf(c)}
        aspect: ${round(c.aspect, 4)},
        ${glowOf(c)}
        luma: ${round(c.luma, 4)},
    },`).join('\n');
    const n = (key, value) => ads.cells.filter((c) => c[key] === value).length;
    const families = `${n('family', 'user')} user adverts, then ${n('family', 'brand')} district-brand pieces`;
    const shapes = `'wide' (16:9, ${n('shape', 'wide')} cells) | 'portrait' (2:3, ${n('shape', 'portrait')})`
        + ` | 'square' (${n('shape', 'square')})`;
    return `/**
 * Neon District — atlas cell table. GENERATED by scripts/neon-district/build-atlases.mjs; do not
 * edit by hand. \`rect\` = (u0, v0, u1, v1) with v down from the top of the image; \`glow\` is the
 * scene-linear, peak-normalised colour the piece throws on the street; \`luma\` its mean luminance.
 */

export const SHOPFRONT_ATLAS = Object.freeze({
    url: './textures/neon-district/shopfronts.webp',
    halfUrl: './textures/neon-district/shopfronts-half.webp',
    width: ${SHOPFRONTS.width},
    height: ${SHOPFRONTS.height},
});

export const SHOPFRONT_CELLS = Object.freeze([
${shopRows}
]);

export const BILLBOARD_ATLAS = Object.freeze({
    url: './textures/neon-district/billboards.webp',
    halfUrl: './textures/neon-district/billboards-half.webp',
    width: ${adsAtlas.width},
    height: ${adsAtlas.height},
});

/**
 * The campaign cells: ${families} (a wide billboard
 * and two portrait posters per brand), ${n('family', 'hale')} Hale pieces and ${n('family', 'transit')} Serenity
 * Transit posters.
 *  - \`family\`: 'user' | 'brand' | 'hale' | 'transit'; \`brand\`: the campaign id (neon-district-campaigns.js),
 *    null for user adverts.
 *  - \`shape\`: ${shapes}; a user advert keeps its own
 *    \`aspect\` inside its shape.
 *  - \`motion\`: 'breathe' (Hale: the shader draws a breathing ring in \`ring\`), 'pan' (transit: drift
 *    and zoom slowly) or 'none'.
 *  - \`ring\`: [cx, cy, r] of the empty ring area in cell fractions (v down from the top, r a fraction
 *    of the cell height), or null.
 *  - \`src\`: the source file of a user advert; null for generated art.
 */
export const BILLBOARD_CELLS = Object.freeze([
${adRows}
]);
`;
}

async function run() {
    // Imported here, not at the top, so a broken campaign module fails the bake instead of hanging it.
    const campaigns = await import(fileUrl(ROOT, 'src', 'themes', 'neon-district', 'neon-district-campaigns.js'));
    const CAMPAIGNS = {
        ...CAMPAIGN_ATLAS,
        cells: packShelves(campaignCells(campaigns), CAMPAIGN_ATLAS.width, CAMPAIGN_ATLAS.height),
    };
    await mkdir(OUT_DIR, { recursive: true });
    const fonts = [];
    for (const [family, weight, file] of FONTS) {
        const bytes = await readFile(path.join(ROOT, 'public', 'fonts', file));
        fonts.push({ family, weight, b64: bytes.toString('base64') });
    }
    const win = new BrowserWindow({
        show: false, width: 320, height: 240, webPreferences: { webSecurity: false },
    });
    try {
        await win.loadURL('data:text/html,<body></body>');
        const faces = await win.webContents.executeJavaScript(
            `(${installFontsInPage.toString()})(${JSON.stringify(fonts)})`,
        );
        console.log(`fonts: ${faces} faces`);
        await win.webContents.executeJavaScript(`(${installArtInPage.toString()})()`);
        const results = [];
        for (const spec of [SHOPFRONTS, CAMPAIGNS]) {
            const baked = await win.webContents.executeJavaScript(
                `(${bakeInPage.toString()})(${JSON.stringify(spec)}, ${GUTTER})`,
            );
            const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
            const full = decode(baked.full);
            const half = decode(baked.half);
            await writeFile(path.join(OUT_DIR, `${spec.file}.webp`), full);
            await writeFile(path.join(OUT_DIR, `${spec.file}-half.webp`), half);
            const kb = (buf) => `${(buf.length / 1024).toFixed(0)} KB`;
            console.log(`${spec.file}.webp ${kb(full)}, half ${kb(half)}, ${baked.cells.length} cells`);
            results.push(baked);
        }
        await writeFile(TABLE, tableSource(results[0], results[1], CAMPAIGNS), 'utf8');
        console.log(`wrote ${OUT_OVERRIDE ? TABLE : path.relative(ROOT, TABLE)}`);
    } finally {
        win.destroy();
    }
}

// A bake never needs minutes; never leave Electron hanging if something stalls.
const watchdog = setTimeout(() => {
    console.error('[build-atlases] FAILED: timed out');
    app.exit(2);
}, 5 * 60 * 1000);
app.whenReady().then(run).then(() => {
    clearTimeout(watchdog);
    app.exit(0);
}).catch((error) => {
    console.error('[build-atlases] FAILED:', error?.stack || error?.message || error);
    app.exit(1);
});
app.on('window-all-closed', () => {});
