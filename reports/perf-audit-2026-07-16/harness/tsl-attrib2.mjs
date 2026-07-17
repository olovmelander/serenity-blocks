import { launch } from './lib.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Runtime.enable');
const stacks = {};
let count = 0;
cdp.on('Runtime.consoleAPICalled', (e) => {
  const first = e.args && e.args[0] && (e.args[0].value || e.args[0].description || '');
  if (!/No stack defined/.test(String(first))) return;
  count++;
  const frames = (e.stackTrace?.callFrames || [])
    .map((f) => `${(f.url || '').split('/').pop()}:${f.lineNumber}:${f.functionName || '?'}`)
    .filter((s) => !/three-/.test(s))
    .slice(0, 4);
  const key = frames.join(' <- ') || '(all-three-frames)';
  stacks[key] = (stacks[key] || 0) + 1;
});
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(50000);
console.log('TSL count:', count);
for (const [k, v] of Object.entries(stacks)) console.log(v + '×', k);
await browser.close();
