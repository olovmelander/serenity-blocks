/**
 * Dev probe: prove the Stillwater troll's skeleton is actually animating.
 * Samples bone rotations and world X over live time.
 *   node scripts/run-electron.mjs scripts/dev/stillwater-troll-motion.mjs
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';

const { app, BrowserWindow } = electron;
const URL_PATH = '/playground.html?effect=stillwater-masterpiece&quality=High&orbit=0&hud=0';

const SAMPLE = `(() => {
  try {
    const scene = window.__PLAYGROUND__ && window.__PLAYGROUND__.scene
      ? window.__PLAYGROUND__.scene() : null;
    const rt = window.__STILLWATER_MASTERPIECE__;
    if (!scene) return JSON.stringify({ error: 'no scene' });
    const bones = [];
    scene.traverse((o) => { if (o.isBone) bones.push(o); });
    bones.sort((a, b) => (a.name < b.name ? -1 : 1));
    // Hash every joint: one bone can legitimately hold still during stance.
    const pick = bones.map((b) => ({
      name: b.name,
      q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]
        .map((v) => Math.round(v * 10000) / 10000),
    }));
    const troll = scene.getObjectByName('stillwater-hero-troll');
    const d = rt && rt.getDiagnostics ? rt.getDiagnostics() : null;
    return JSON.stringify({
      boneCount: bones.length,
      x: troll ? Math.round(troll.position.x * 1000) / 1000 : null,
      y: troll ? Math.round(troll.position.y * 1000) / 1000 : null,
      state: d && d.characters ? d.characters.trollState : null,
      bones: pick,
    });
  } catch (err) { return JSON.stringify({ error: String(err && err.message || err) }); }
})()`;

app.whenReady().then(async () => {
    // A hidden BrowserWindow throttles rAF, which freezes every dt-driven
    // simulation in the page and makes the skeleton look broken when it is not.
    const win = new BrowserWindow({ width: 1280, height: 720, show: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
            backgroundThrottling: false } });
    await win.loadURL(new URL(URL_PATH, 'http://127.0.0.1:5173').toString());
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        if (await win.webContents.executeJavaScript('window.__PLAYGROUND_READY__===true')) break;
        await new Promise((r) => { setTimeout(r, 250); });
    }
    // Let the troll leave its hidden dwell and start walking.
    await new Promise((r) => { setTimeout(r, 7000); });
    const samples = [];
    for (let i = 0; i < 12; i += 1) {
        samples.push(JSON.parse(await win.webContents.executeJavaScript(SAMPLE)));
        await new Promise((r) => { setTimeout(r, 230); });
    }
    process.stdout.write(`${JSON.stringify(samples)}\n`);
    win.destroy();
    app.quit();
});
