/**
 * Dev probe: report where the Stillwater hero troll actually is in the live graph.
 *   node scripts/run-electron.mjs scripts/dev/stillwater-probe.mjs
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';

const { app, BrowserWindow } = electron;
const URL_PATH = '/playground.html?effect=stillwater-masterpiece&quality=High&orbit=0&t=26&hud=0';

const SNIPPET = `(() => {
  try {
    const rt = window.__STILLWATER_MASTERPIECE__;
    let scene = null;
    scene = window.__PLAYGROUND__ && window.__PLAYGROUND__.scene ? window.__PLAYGROUND__.scene() : null;
    if (!scene) return JSON.stringify({ error: 'no scene from camera', hasRt: !!rt });
    const hits = [];
    scene.traverse((o) => {
      if (!o.name || !/troll|spirit|foxfire|lantern|mote/i.test(o.name)) return;
      let meshes = 0; let visMeshes = 0; let tris = 0; let op = null; let culled = null;
      o.traverse((c) => {
        if (!c.isMesh) return;
        meshes += 1;
        if (c.visible) visMeshes += 1;
        culled = c.frustumCulled;
        const m = Array.isArray(c.material) ? c.material[0] : c.material;
        if (m && op === null) op = m.opacity;
        const g = c.geometry;
        if (g) tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
      });
      let chainVisible = true; let n = o; const chain = [];
      while (n) { chain.push((n.name || n.type) + '=' + n.visible); if (!n.visible) chainVisible = false; n = n.parent; }
      o.updateMatrixWorld(true);
      const e = o.matrixWorld.elements;
      hits.push({ name: o.name, kids: o.children.length, meshes, visMeshes, tris, opacity: op,
                  frustumCulled: culled, chainVisible, chain: chain.join(' < '),
                  world: [Math.round(e[12]*100)/100, Math.round(e[13]*100)/100, Math.round(e[14]*100)/100] });
    });
    return JSON.stringify({ sceneType: scene.type, sceneChildren: scene.children.length, hits });
  } catch (err) { return JSON.stringify({ error: String(err && err.message || err) }); }
})()`;

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await win.loadURL(new URL(URL_PATH, 'http://127.0.0.1:5173').toString());
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        if (await win.webContents.executeJavaScript('window.__PLAYGROUND_READY__===true')) break;
        await new Promise((r) => { setTimeout(r, 250); });
    }
    await new Promise((r) => { setTimeout(r, 5000); });
    process.stdout.write(`${await win.webContents.executeJavaScript(SNIPPET)}\n`);
    win.destroy();
    app.quit();
});
