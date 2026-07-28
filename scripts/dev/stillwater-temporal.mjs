/**
 * Dev probe: measure TEMPORAL stability of the painterly pass.
 *
 * Kuwahara's characteristic failure is sector crawl — the chosen sector flips
 * between frames and region colour shimmers. A `?t=` capture cannot show this
 * because it freezes dt, so this samples consecutive LIVE frames and reports
 * per-pixel luma variance in regions that should be perfectly static.
 *
 *   node scripts/run-electron.mjs scripts/dev/stillwater-temporal.mjs
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';

const { app, BrowserWindow } = electron;
const URL_PATH = process.env.SW_URL || '/playground.html?effect=stillwater-masterpiece&quality=High&orbit=0&hud=0';
const FRAMES = 8;

app.whenReady().then(async () => {
    // Visible + unthrottled: a hidden window throttles rAF and would report a
    // perfectly stable image simply because nothing advanced.
    const win = new BrowserWindow({
        width: 960,
        height: 560,
        show: true,
        webPreferences: {
            contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
        },
    });
    await win.loadURL(new URL(URL_PATH, 'http://127.0.0.1:5173').toString());
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        if (await win.webContents.executeJavaScript('window.__PLAYGROUND_READY__===true')) break;
        await new Promise((r) => { setTimeout(r, 250); });
    }
    await new Promise((r) => { setTimeout(r, 4000); });

    const frames = [];
    for (let i = 0; i < FRAMES; i += 1) {
        const image = await win.webContents.capturePage();
        frames.push(image.getBitmap());
        await new Promise((r) => { setTimeout(r, 120); });
    }

    const { width, height } = (await win.webContents.capturePage()).getSize();
    const pixels = width * height;
    const mean = new Float64Array(pixels);
    const meanSquare = new Float64Array(pixels);
    for (const bitmap of frames) {
        for (let p = 0; p < pixels; p += 1) {
            const o = p * 4;
            // Electron bitmaps are BGRA.
            const luma = 0.0722 * bitmap[o] + 0.7152 * bitmap[o + 1] + 0.2126 * bitmap[o + 2];
            mean[p] += luma / frames.length;
            meanSquare[p] += (luma * luma) / frames.length;
        }
    }
    let over1 = 0;
    let over2 = 0;
    let maxSd = 0;
    let sumSd = 0;
    for (let p = 0; p < pixels; p += 1) {
        const sd = Math.sqrt(Math.max(0, meanSquare[p] - mean[p] * mean[p]));
        sumSd += sd;
        if (sd > maxSd) maxSd = sd;
        if (sd > 1) over1 += 1;
        if (sd > 2) over2 += 1;
    }
    process.stdout.write(`${JSON.stringify({
        frames: frames.length,
        width,
        height,
        meanSd: sumSd / pixels,
        maxSd,
        fractionOver1: over1 / pixels,
        fractionOver2: over2 / pixels,
    })}\n`);
    win.destroy();
    app.quit();
});
