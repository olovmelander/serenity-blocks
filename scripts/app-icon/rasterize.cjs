/* eslint-disable import/no-extraneous-dependencies */
// Electron main process for scripts/generate-app-icon.mjs: draws each SVG at its exact size in
// Chromium (the browser's own antialiasing) and writes the PNGs.
// Usage: electron rasterize.cjs <jobs.json>, where jobs.json is [{ svg, size, out }].
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const jobsFile = process.argv[process.argv.findIndex((arg) => arg.endsWith('rasterize.cjs')) + 1];
app.commandLine.appendSwitch('force-device-scale-factor', '1');
process.on('unhandledRejection', (error) => {
    console.error(error);
    app.exit(1);
});

app.whenReady().then(async () => {
    const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html,<!doctype html><title>raster</title>');
    for (const job of jobs) {
        // One at a time: each job waits for its image to load.
        // eslint-disable-next-line no-await-in-loop
        const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = ${job.size};
                canvas.height = ${job.size};
                canvas.getContext('2d').drawImage(img, 0, 0, ${job.size}, ${job.size});
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('SVG failed to load'));
            img.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(job.svg).toString('base64')}`)};
        })`);
        fs.writeFileSync(job.out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    app.quit();
});
