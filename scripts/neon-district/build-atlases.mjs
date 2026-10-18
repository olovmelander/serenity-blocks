/**
 * Neon District — bake the shopfront atlas and the campaign (billboard) atlas.
 *
 * Shopfronts: the district's painted shopfronts (scripts/neon-district/source-art/), packed with
 * edge-extended gutters into one WebP atlas.
 *
 * Campaigns: everything the district advertises, packed the same way into a 4096 × 2048 atlas —
 * the user adverts from source-art/, and the generated campaigns painted here on a 2D canvas: the
 * eight district brands (one 16:9 billboard and one 2:3 poster each), Hale's calm spots (with an
 * empty ring the theme's shader breathes in) and the Serenity Transit travel posters, framed
 * around the game's own renders of its worlds (docs/ captures) and modes (public/assets/menu-art/).
 *
 * Writes the cell table the theme reads (src/themes/neon-district/neon-district-atlas.js): UV rect,
 * aspect, the colour each piece throws on the street (a luminance-weighted mean, scene-linear,
 * peak-normalised) and, for the campaign atlas, what each cell is (id, family, brand, shape, motion,
 * ring).
 *
 *   node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs
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
const OUT_DIR = path.join(ROOT, 'public', 'textures', 'neon-district');
const TABLE = path.join(ROOT, 'src', 'themes', 'neon-district', 'neon-district-atlas.js');
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
 * Serenity Transit world posters. `image` is the game's own render of the world (docs/ captures),
 * `crop` the part of it framed ([x, y, w, h] in source pixels, no UI in it), `accent` the colour
 * the poster takes from it. Ids are theme ids from the registry; names are its display names.
 */
const TRANSIT_WORLDS = [
    {
        id: 'koi-pond',
        name: ['KOI POND'],
        line: 'MOONWAKE NIGHTS',
        accent: 0xff7a4a,
        image: 'docs/koi-pond-overhaul/koi.jpg',
        crop: [450, 0, 700, 654],
    },
    {
        id: 'sakura-twilight',
        name: ['SAKURA', 'TWILIGHT'],
        line: 'THE MOONLIT GARDEN',
        accent: 0xffa8cc,
        image: 'docs/sakura-twilight-overhaul/idle.jpg',
        crop: [250, 0, 680, 636],
    },
    {
        id: 'crystal-cave',
        name: ['CRYSTAL', 'CAVE'],
        line: 'THE RESONANT HALL',
        accent: 0x46f0d4,
        image: 'docs/crystal-cave-overhaul/idle.webp',
        crop: [300, 0, 680, 636],
    },
    {
        id: 'golden-forest',
        name: ['GOLDEN', 'FOREST'],
        line: 'THE LAKE AT THE GOLDEN HOUR',
        accent: 0xffc44e,
        image: 'docs/golden-forest-lake/idle.webp',
        crop: [110, 0, 680, 636],
    },
    {
        id: 'summer',
        name: ['MIDSOMMAR'],
        line: 'THE SUN THAT WILL NOT SET',
        accent: 0xffe46e,
        image: 'docs/summer-midsommar/idle.webp',
        crop: [160, 0, 730, 682],
    },
    {
        id: 'ocean',
        name: ['OCEAN'],
        line: 'THE EDGE OF THE BLUE',
        accent: 0x56d9ff,
        image: 'docs/ocean-overhaul/01-idle.webp',
        crop: [270, 0, 740, 688],
    },
    {
        id: 'winter',
        name: ['WINTER'],
        line: 'FOLLOW THE FOX FIRES',
        accent: 0x7cffcb,
        image: 'docs/winter-fox-fires/rest.webp',
        crop: [0, 0, 490, 458],
    },
    {
        id: 'stillwater',
        name: ['STILLWATER'],
        line: 'THE TARN AT NIGHT',
        accent: 0xffa848,
        image: 'docs/stillwater-overhaul/desktop-rest.jpg',
        crop: [90, 0, 820, 766],
    },
];

/**
 * Serenity Transit mode posters: the menu's key art for the mode (cropped clear of the board and
 * its panels) and lines taken from the mode's own menu copy. `stops` = stop dots on the route.
 */
const TRANSIT_MODES = [
    {
        id: 'infinity',
        name: 'INFINITY',
        line: 'HOW HIGH WILL YOU GO?',
        sub: 'ONE THOUSAND ROWS TALL',
        accent: 0xff8fdc,
        stops: 3,
        images: [{ image: 'public/assets/menu-art/infinity.webp', crop: [70, 0, 730, 640] }],
    },
    {
        id: 'stillfall',
        name: 'STILLFALL',
        line: 'GRAVITY WAITS WHILE YOU CHOOSE',
        sub: 'A FEW PIECES AND ONE GOAL',
        accent: 0xffac88,
        stops: 6,
        images: [{ image: 'public/assets/menu-art/stillfall.webp', crop: [100, 0, 730, 640] }],
    },
    {
        id: 'odyssey',
        name: 'ODYSSEY',
        line: 'FROM THE EARTH\'S CORE',
        sub: 'TO THE EDGE OF A BLACK HOLE',
        accent: 0xffa04e,
        stops: 3,
        images: [
            { image: 'public/assets/menu-art/odyssey-1.webp', crop: [300, 40, 640, 594] },
            { image: 'public/assets/menu-art/odyssey-7.webp', crop: [600, 0, 430, 600] },
        ],
    },
];

const withUrls = (images) => images.map((im) => ({ url: fileUrl(ROOT, im.image), crop: im.crop }));

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
    for (const brand of BRANDS) {
        for (const shape of ['wide', 'portrait']) {
            cells.push({
                id: `brand-${brand.id}-${shape}`,
                family: 'brand',
                brand: brand.id,
                shape,
                motion: 'none',
                ring: null,
                src: null,
                paint: { kind: 'brand', brand },
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
    for (const world of TRANSIT_WORLDS) {
        cells.push({
            id: `transit-${world.id}`,
            family: 'transit',
            brand: 'transit',
            shape: 'portrait',
            motion: 'pan',
            ring: null,
            src: null,
            paint: {
                kind: 'world', brand: TRANSIT, poster: world, images: withUrls([world]),
            },
        });
    }
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

const CAMPAIGN_ATLAS = { file: 'billboards', width: 4096, height: 2048 };

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
    /** Draws `crop` of an image to cover the box, trimming the crop to the box's aspect. */
    function cover(ctx, img, crop, dx, dy, dw, dh, focus = [0.5, 0.5]) {
        let [sx, sy, sw, sh] = crop;
        const want = dw / dh;
        if (sw / sh > want) {
            const nw = sh * want;
            sx += (sw - nw) * focus[0];
            sw = nw;
        } else {
            const nh = sw / want;
            sy += (sh - nh) * focus[1];
            sh = nh;
        }
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    // ---- marks (100-unit box centred on the origin) -----------------------------------------
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

    // ---- Serenity Transit ------------------------------------------------------------------
    const CREAM = 0xf2e6c8;
    function transitHeader(ctx, T, x, y, size, accent, right) {
        mark(ctx, 'transit', x + size / 2, y, size, [INK, T.a, T.b]);
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
    function paintWorld(ctx, w, h, T, p, imgs) {
        const { accent } = p;
        ground(ctx, w, h, 0x0d1020, INK);
        ctx.strokeStyle = css(CREAM, 0.22);
        ctx.lineWidth = 1;
        ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
        const m = 12;
        transitHeader(ctx, T, m, 21, 20, accent, w - m);
        const fx = m;
        const fy = 38;
        const fw = w - m * 2;
        // Laid out from the foot up, so every poster keeps one rhythm whatever its name's length.
        const name = {
            family: UNB,
            weight: 800,
            size: p.name.length > 1 ? 40 : 52,
            spacing: 0.02,
            color: css(CREAM),
            maxW: fw,
        };
        const strapBase = h - 46;
        const nameH = p.name.reduce((sum, str, i) => sum + (i ? 8 : 0) + capOf(ctx, sized(ctx, str, name)), 0);
        const nameTop = strapBase - 26 - nameH;
        const fh = Math.round(nameTop - 18 - fy);
        cover(ctx, imgs[0].img, imgs[0].crop, fx, fy, fw, fh);
        const shade = ctx.createLinearGradient(0, fy + fh * 0.62, 0, fy + fh);
        shade.addColorStop(0, 'rgba(6,8,16,0)');
        shade.addColorStop(1, 'rgba(6,8,16,0.55)');
        ctx.fillStyle = shade;
        ctx.fillRect(fx, fy, fw, fh);
        ctx.strokeStyle = css(CREAM, 0.95);
        ctx.lineWidth = 2;
        ctx.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
        block(ctx, p.name.map((str) => ({ str, gap: 8, s: name })), m, nameTop);
        line(ctx, p.line, m, strapBase, {
            family: MAN, weight: 800, size: 14, spacing: 0.16, color: css(accent), maxW: fw,
        });
        route(ctx, m + 2, w - m - 2, h - 20, 3, accent, CREAM, 1);
    }
    function paintMode(ctx, w, h, T, p, imgs) {
        const { accent } = p;
        ground(ctx, w, h, 0x0d1020, INK);
        if (imgs.length === 1) {
            // One picture on the right, fading into the ink behind the words.
            const ix = Math.round(w * 0.38);
            cover(ctx, imgs[0].img, imgs[0].crop, ix, 0, w - ix, h);
            const fade = ctx.createLinearGradient(ix, 0, ix + 150, 0);
            fade.addColorStop(0, css(INK, 1));
            fade.addColorStop(1, css(INK, 0));
            ctx.fillStyle = fade;
            ctx.fillRect(ix, 0, 150, h);
        } else {
            // A journey, from one picture to the other across the whole board; the words sit on the
            // first (the wider one), clear of the seam.
            const split = Math.round(w * 0.6);
            cover(ctx, imgs[0].img, imgs[0].crop, 0, 0, split, h);
            cover(ctx, imgs[1].img, imgs[1].crop, split, 0, w - split, h);
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
        const boxes = block(ctx, [
            {
                str: p.name,
                s: {
                    family: UNB,
                    weight: 800,
                    size: 60,
                    color: css(CREAM),
                    maxW: w * 0.54,
                    glow: 10,
                    glowColor: css(INK),
                },
            },
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
        ], x, 0, { middle: h * 0.52 });
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
        const id = `${spec.kind}-${spec.brand.id}-${spec.poster ? spec.poster.id : ''}-${shape}`;
        if (spec.kind === 'brand') {
            BRAND_PAINTERS[spec.brand.id](ctx, w, h, spec.brand, wide);
            vignette(ctx, w, h, 0.35);
        } else if (spec.kind === 'hale') {
            paintHale(ctx, w, h, spec.brand, wide, spec.ring);
        } else {
            const imgs = [];
            for (const im of spec.images) imgs.push({ img: await load(im.url), crop: im.crop });
            if (spec.kind === 'world') paintWorld(ctx, w, h, spec.brand, spec.poster, imgs);
            else paintMode(ctx, w, h, spec.brand, spec.poster, imgs);
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
 * and a portrait poster per brand), ${n('family', 'hale')} Hale pieces and ${n('family', 'transit')} Serenity
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
        console.log(`wrote ${path.relative(ROOT, TABLE)}`);
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
