// Device census over repeated in-play switches: every device created should be destroyed once its
// theme is gone, leaving at most the playing theme's, an outgoing one under a crossfade and a spare.
(async () => {
  const B = window.__BENCH__;
  const app = window.serenityBlocks;
  const tm = app.themeManager;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const order = ['nimbus-veil', 'forest', 'aurora', 'fall', 'nimbus-veil', 'forest', 'aurora', 'fall'];
  const rows = [];
  for (const id of order) {
    app.settingsManager.update({ backgroundMode: 'Specific', backgroundTheme: id });
    const t0 = performance.now();
    while (performance.now() - t0 < 20000) {
      await sleep(200);
      if (tm.activeTheme && tm.activeTheme.name === id && tm.activeTheme.lifecycleState === 'running' && !tm.isTransitioning) break;
    }
    await sleep(6500); // crossfade, outgoing disposal and the spare's refill
    rows.push({ theme: id, created: B.devices.length, destroyed: B.devicesDestroyed, live: B.devices.length - B.devicesDestroyed });
  }
  return { rows };
})()
