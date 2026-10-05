/**
 * Neon District — bake the shopfront and billboard atlases.
 *
 * Packs the district's shopfront paintings and billboard art (scripts/neon-district/source-art/) into two
 * WebP atlases with edge-extended gutters, and writes the cell table the theme reads
 * (src/themes/neon-district/neon-district-atlas.js): UV rect, aspect and the colour each piece
 * throws on the street (a luminance-weighted mean, scene-linear, peak-normalised).
 *
 *   node scripts/run-electron.mjs scripts/neon-district/build-atlases.mjs
 *
 * Electron is only used for its canvas (decode, scale, encode); nothing is rendered on a GPU.
 */
/* eslint-disable import/no-extraneous-dependencies */
import electron from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const { app, BrowserWindow } = electron;
const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'scripts', 'neon-district', 'source-art');
const OUT_DIR = path.join(ROOT, 'public', 'textures', 'neon-district');
const TABLE = path.join(ROOT, 'src', 'themes', 'neon-district', 'neon-district-atlas.js');
const GUTTER = 6;

const pad = (n) => String(n).padStart(2, '0');

/** Shopfronts: eight 1.27:1 pieces, then nine wide cells (the 2.45:1 arcade is letterboxed). */
const SHOPFRONTS = {
    file: 'shopfronts',
    width: 2560,
    height: 2556,
    cells: [
        ...[2, 3, 4, 5, 6, 7, 8, 9].map((n, i) => ({
            src: `storefront_${pad(n)}.jpg`, x: (i % 4) * 640, y: Math.floor(i / 4) * 504, w: 640, h: 504,
        })),
        ...[11, 12, 13, 14, 15, 16, 17, 18, 10].map((n, i) => ({
            src: `storefront_${pad(n)}.jpg`, x: (i % 3) * 853, y: 1008 + Math.floor(i / 3) * 516, w: 853, h: 516,
        })),
    ],
};

/** Billboards: four wide screens, then seven square ones. */
const BILLBOARDS = {
    file: 'billboards',
    width: 2048,
    height: 2048,
    cells: [
        ...[8, 9, 10, 11].map((n, i) => ({
            src: `ads_large_${pad(n)}.jpg`, x: (i % 2) * 1024, y: Math.floor(i / 2) * 560, w: 1024, h: 560,
        })),
        ...[7, 12, 13, 15, 16, 17, 18].map((n, i) => ({
            src: `ads_large_${pad(n)}.jpg`, x: (i % 4) * 464, y: 1120 + Math.floor(i / 4) * 464, w: 464, h: 464,
        })),
    ],
};

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
    const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const cells = [];
    for (const cell of spec.cells) {
        const img = await load(cell.url);
        const aspect = img.naturalWidth / img.naturalHeight;
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
        cells.push({
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

function tableSource(shop, ads) {
    const rows = (cells) => cells.map((c) => `    {
        src: '${c.src}',
        rect: [${c.rect.map((v) => round(v)).join(', ')}],
        aspect: ${round(c.aspect, 4)},
        glow: [${c.glow.map((v) => round(v, 3)).join(', ')}],
        luma: ${round(c.luma, 4)},
    },`).join('\n');
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
${rows(shop.cells)}
]);

export const BILLBOARD_ATLAS = Object.freeze({
    url: './textures/neon-district/billboards.webp',
    halfUrl: './textures/neon-district/billboards-half.webp',
    width: ${BILLBOARDS.width},
    height: ${BILLBOARDS.height},
});

/** The first ${ads.cells.filter((c) => c.aspect > 1.4).length} cells are wide screens, the rest square. */
export const BILLBOARD_CELLS = Object.freeze([
${rows(ads.cells)}
]);
`;
}

async function run() {
    await mkdir(OUT_DIR, { recursive: true });
    const win = new BrowserWindow({
        show: false, width: 320, height: 240, webPreferences: { webSecurity: false },
    });
    await win.loadURL('data:text/html,<body></body>');
    const results = [];
    for (const spec of [SHOPFRONTS, BILLBOARDS]) {
        const withUrls = {
            ...spec,
            cells: spec.cells.map((c) => ({ ...c, url: pathToFileURL(path.join(SOURCE, c.src)).href })),
        };
        // eslint-disable-next-line no-await-in-loop
        const baked = await win.webContents.executeJavaScript(
            `(${bakeInPage.toString()})(${JSON.stringify(withUrls)}, ${GUTTER})`,
        );
        const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        const full = decode(baked.full);
        const half = decode(baked.half);
        // eslint-disable-next-line no-await-in-loop
        await writeFile(path.join(OUT_DIR, `${spec.file}.webp`), full);
        // eslint-disable-next-line no-await-in-loop
        await writeFile(path.join(OUT_DIR, `${spec.file}-half.webp`), half);
        console.log(`${spec.file}.webp ${(full.length / 1024).toFixed(0)} KB, half ${(half.length / 1024).toFixed(0)} KB, ${baked.cells.length} cells`);
        results.push(baked);
    }
    await writeFile(TABLE, tableSource(results[0], results[1]), 'utf8');
    console.log(`wrote ${path.relative(ROOT, TABLE)}`);
    win.destroy();
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
    console.error('[build-atlases] FAILED:', error?.message || error);
    app.exit(1);
});
app.on('window-all-closed', () => app.quit());
