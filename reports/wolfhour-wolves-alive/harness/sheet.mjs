// Contact sheet of GPU captures: crop each, label it, lay them out, write a JPEG.
// Usage: electron sheet.mjs <spec.json> <out.jpg>
import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const [specPath, out] = process.argv.slice(-2);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

app.whenReady().then(async () => {
    const cells = spec.cells.map((c) => {
        const img = nativeImage.createFromPath(c.file).crop({
            x: c.crop[0], y: c.crop[1], width: c.crop[2], height: c.crop[3],
        })
            .resize({ width: spec.cellW, height: spec.cellH, quality: 'best' });
        return { url: img.toDataURL(), label: c.label };
    });
    const { cols } = spec;
    const rows = Math.ceil(cells.length / cols);
    const W = cols * spec.cellW;
    const H = rows * spec.cellH;
    const win = new BrowserWindow({
        show: false, width: 400, height: 300, webPreferences: { offscreen: false },
    });
    await win.loadURL('about:blank');
    const data = await win.webContents.executeJavaScript(`(async () => {
        const cells = ${JSON.stringify(cells)};
        const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
        const g = c.getContext('2d');
        g.fillStyle = '#05070c'; g.fillRect(0, 0, ${W}, ${H});
        for (let i = 0; i < cells.length; i++) {
            const im = new Image(); im.src = cells[i].url; await im.decode();
            const x = (i % ${cols}) * ${spec.cellW}; const y = Math.floor(i / ${cols}) * ${spec.cellH};
            g.drawImage(im, x, y);
            g.strokeStyle = '#05070c'; g.lineWidth = 3; g.strokeRect(x, y, ${spec.cellW}, ${spec.cellH});
            g.font = '600 19px Segoe UI, sans-serif';
            const w = g.measureText(cells[i].label).width;
            g.fillStyle = 'rgba(5,7,12,0.72)'; g.fillRect(x + 10, y + ${spec.cellH} - 38, w + 18, 28);
            g.fillStyle = '#e8ecf4'; g.fillText(cells[i].label, x + 19, y + ${spec.cellH} - 17);
        }
        return c.toDataURL('image/jpeg', 0.86);
    })()`);
    fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', out, W, H);
    app.quit();
});
