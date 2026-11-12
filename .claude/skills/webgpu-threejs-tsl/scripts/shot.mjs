#!/usr/bin/env node
/**
 * Capture a playground URL with a private headless Chrome: a screenshot, the backend it ran on,
 * and every console warning and error. No dependencies (Node 22+: global fetch and WebSocket).
 *
 *   node .claude/skills/webgpu-threejs-tsl/scripts/shot.mjs <out.png> "<url>" [width] [height] [settleMs]
 *
 *   node .claude/skills/webgpu-threejs-tsl/scripts/shot.mjs shots/a.png \
 *     "http://localhost:5173/playground.html?effect=winter&t=8&maxFps=30"
 *   ... "…&forceWebGL=1"            the WebGL2 backend
 *   ... "…&quality=Minimal"         the lowest tier
 *   ... "<url>" 390 844             a tall phone frame
 *
 * When to use it: the `chrome-devtools` MCP drives ONE shared browser profile, and a second
 * session that reaches for it gets "The browser is already running". Never close that browser:
 * it is another session's. This script starts its own Chrome with its own throwaway profile
 * and port, and stops only the process it started. On a machine with a GPU it runs real WebGPU
 * (the first line it prints names the adapter); it is not for cloud containers without one
 * (docs/theme-concepts/PLAYBOOK.md §5 covers those).
 *
 * It waits for `window.__PLAYGROUND_READY__ === true`, then `settleMs` more (default 3500: the
 * first frame draws the raw scene, the post chain runs from the next tick, and a heavy scene's
 * pipelines take seconds). Exit code 1 when the page never became ready or the console was not
 * clean, so a script can gate on it. Chrome is found through CHROME_PATH or the usual places.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [out, url, width = '1280', height = '720', settle = '3500'] = process.argv.slice(2);
if (!out || !url) {
    console.error('usage: node shot.mjs <out.png> "<url>" [width] [height] [settleMs]');
    process.exit(2);
}

const chromePath = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
].find((candidate) => candidate && existsSync(candidate));
if (!chromePath) {
    console.error('Chrome not found: set CHROME_PATH to the executable');
    process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const profile = mkdtempSync(path.join(os.tmpdir(), 'serenity-shot-'));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--force-device-scale-factor=1',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    'about:blank',
], { stdio: 'ignore' });

let finished = false;
async function finish(code) {
    if (finished) return;
    finished = true;
    try { chrome.kill(); } catch { /* already gone */ }
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still holds a file: the OS clears temp */ }
    process.exit(code);
}
setTimeout(() => { console.error('timed out after 180 s'); finish(1); }, 180000);

let target = null;
for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = pages.find((page) => page.type === 'page');
    } catch { /* Chrome is still starting */ }
}
if (!target) { console.error('Chrome did not open a page'); await finish(1); }

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 1;
const waiting = new Map();
const heard = [];
socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); return; }
    const { method, params } = message;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) {
        heard.push(`[console.${params.type}] ${params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 500)}`);
    } else if (method === 'Runtime.exceptionThrown') {
        heard.push(`[exception] ${(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text).slice(0, 600)}`);
    } else if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) {
        heard.push(`[log.${params.entry.level}] ${params.entry.text.slice(0, 500)}`);
    }
};
const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

let ready = false;
for (let i = 0; i < 480 && !ready; i++) {
    await sleep(250);
    ready = (await evaluate('window.__PLAYGROUND_READY__ === true')) === true;
}
await sleep(Number(settle));

const info = await evaluate(`JSON.stringify({
    backend: window.__PLAYGROUND__?.backend?.() ?? null,
    canvas: (() => { const c = document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null; })(),
    webgpu: !!navigator.gpu,
})`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const saved = Boolean(shot.result?.data);
if (saved) {
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
}
const messages = [...new Set(heard)];
console.log(`${ready ? 'ready' : 'NOT READY (window.__PLAYGROUND_READY__ never became true)'} ${info ?? ''}`);
console.log(messages.length ? `console (${messages.length}):\n  ${messages.join('\n  ')}` : 'console: clean');
console.log(saved ? `saved ${out}` : 'NO SCREENSHOT');
await send('Browser.close').catch(() => {});
await finish(ready && saved && messages.length === 0 ? 0 : 1);
