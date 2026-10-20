// Circle-crop a square capture into a theme icon: ICON_IN (square PNG) -> ICON_OUT (size² PNG,
// transparent outside the circle) and ICON_PREVIEW (80 px). Runs in Electron (canvas only).
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.env.ICON_IN;
const output = process.env.ICON_OUT;
const preview = process.env.ICON_PREVIEW;
const size = Number(process.env.ICON_SIZE || 512);

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 200, height: 200 });
    await win.loadURL('data:text/html,<canvas></canvas>');
    const source = `data:image/png;base64,${readFileSync(input).toString('base64')}`;
    const result = await win.webContents.executeJavaScript(`(async () => {
        const img = new Image();
        img.src = ${JSON.stringify(source)};
        await img.decode();
        const draw = (n) => {
            const c = document.createElement('canvas');
            c.width = n; c.height = n;
            const g = c.getContext('2d');
            g.imageSmoothingQuality = 'high';
            g.beginPath();
            g.arc(n / 2, n / 2, n / 2 - 0.5, 0, Math.PI * 2);
            g.closePath();
            g.clip();
            g.drawImage(img, 0, 0, n, n);
            return c.toDataURL('image/png');
        };
        return { icon: draw(${size}), small: draw(80) };
    })()`);
    writeFileSync(output, Buffer.from(result.icon.split(',')[1], 'base64'));
    if (preview) writeFileSync(preview, Buffer.from(result.small.split(',')[1], 'base64'));
    win.destroy();
    app.quit();
});
