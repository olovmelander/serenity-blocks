import { chromium } from 'playwright-core';

export const GPU_ARGS = [
  '--no-sandbox',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-webgpu-adapter=swiftshader',
  '--enable-unsafe-swiftshader',
];

export async function launch({ webgl = false } = {}) {
  const args = [...GPU_ARGS];
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    ignoreDefaultArgs: ['--disable-gpu'],
    args,
  });
  return browser;
}

export function attachConsole(page, sink) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') sink.push({ t: Date.now(), type, text: msg.text().slice(0, 500) });
  });
  page.on('pageerror', (err) => sink.push({ t: Date.now(), type: 'pageerror', text: String(err).slice(0, 500) }));
}

// Frame-time collector installed in the page: records rAF deltas + longtasks.
export const COLLECTOR_SNIPPET = `(() => {
  if (window.__ftCollector) return;
  const c = { deltas: [], last: null, running: true, longtasks: [], raf: null };
  window.__ftCollector = c;
  const tick = (t) => {
    if (c.last !== null) c.deltas.push(t - c.last);
    c.last = t;
    if (c.running) c.raf = requestAnimationFrame(tick);
  };
  c.raf = requestAnimationFrame(tick);
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) c.longtasks.push({ start: e.startTime, dur: e.duration });
    });
    po.observe({ entryTypes: ['longtask'] });
    c.po = po;
  } catch (e) {}
})()`;

export function summarize(deltas) {
  if (!deltas.length) return null;
  const s = [...deltas].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    mean: +mean.toFixed(2),
    p50: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    p99: +q(0.99).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    over16_7: s.filter((d) => d > 16.7 * 1.5).length,
    over33: s.filter((d) => d > 33.4).length,
    over50: s.filter((d) => d > 50).length,
    over100: s.filter((d) => d > 100).length,
    fpsAvg: +(1000 / mean).toFixed(1),
  };
}
