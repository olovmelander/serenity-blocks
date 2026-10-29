// Pass profiler, run by the bench's evalAfterLoad: GPU ms per render pass per frame, with the
// theme capped at 60 fps so three's timestamp pool (2048 queries) is resolved before it fills.
(async () => {
  const B = window.__BENCH__;
  const app = window.serenityBlocks;
  const th = app.themeManager.activeTheme;
  const r = th.renderer;
  const be = r && r.backend;
  if (!be || !be.isWebGPUBackend) return { error: 'not a webgpu theme renderer' };
  if (!be.device.features.has('timestamp-query')) return { error: 'no timestamp-query' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const labels = new Map();
  const origBegin = be.beginRender.bind(be);
  be.beginRender = (rc) => {
    const key = r.info.render.frameCalls + ':' + rc.id;
    if (!labels.has(key)) {
      const rt = rc.renderTarget;
      const tex = rt && (rt.textures ? rt.textures[0] : rt.texture);
      labels.set(key, {
        cam: rc.camera ? rc.camera.type : null,
        target: rt ? (tex && tex.name) || rt.name || 'rt' : 'canvas',
        size: `${rc.width}x${rc.height}`,
        samples: rc.sampleCount || 1,
        mrt: rt && rt.textures ? rt.textures.length : 1,
        depth: !!rc.depth,
      });
    }
    return origBegin(rc);
  };
  const prevFps = app.settingsManager.get().targetFrameRate;
  app.settingsManager.update({ targetFrameRate: 60 });
  B.allowTimestamps = true;
  be.trackTimestamp = true;
  await sleep(800);
  const sums = new Map();
  const frames = new Set();
  const until = performance.now() + 6000;
  while (performance.now() < until) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => requestAnimationFrame(res));
    // eslint-disable-next-line no-await-in-loop
    await r.resolveTimestampsAsync('render');
    const pool = be.timestampQueryPool && be.timestampQueryPool.render;
    if (!pool) continue;
    for (const [uid, d] of pool.timestamps) {
      const m = /^r:(\d+):([^:]+):f(\d+)$/.exec(uid);
      if (!m) continue;
      const lab = labels.get(m[1] + ':' + m[2]);
      const key = lab ? `${lab.target}|${lab.size}|s${lab.samples}|${lab.cam === 'PerspectiveCamera' ? 'scene' : 'quad'}` : 'ctx ' + m[2];
      const f = Number(m[3]);
      frames.add(f);
      const cur = sums.get(key) || { ms: 0, n: 0, frames: new Set() };
      cur.ms += d; cur.n += 1; cur.frames.add(f);
      sums.set(key, cur);
    }
    pool.timestamps.clear();
  }
  be.trackTimestamp = false;
  B.allowTimestamps = false;
  be.beginRender = origBegin;
  app.settingsManager.update({ targetFrameRate: prevFps });
  const nFrames = frames.size || 1;
  const rows = [...sums].map(([id, v]) => ({
    pass: id,
    msPerFrame: +(v.ms / nFrames).toFixed(3),
    passesPerFrame: +(v.n / nFrames).toFixed(2),
  })).sort((a, b) => b.msPerFrame - a.msPerFrame);
  const total = rows.reduce((s, x) => s + x.msPerFrame, 0);
  return { theme: th.name, frames: nFrames, totalGpuMs: +total.toFixed(3), rows: rows.slice(0, 30) };
})()
