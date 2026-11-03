/**
 * A page in the installed Chrome, headless, driven over the DevTools protocol: for bake scripts
 * that need a browser's canvas (decode, draw, scale, encode) and nothing else. No dependency:
 * Node's own WebSocket talks to Chrome. The GPU is off (`--disable-gpu`, no accelerated 2D
 * canvas), so drawing runs on the CPU and the same input gives the same bytes.
 *
 *   const page = await openHeadlessPage();
 *   const value = await page.evaluate('(async () => 42)()');
 *   await page.close();
 *
 * The page is a blank file:// document with file access and web security off, so it can draw
 * local pictures by file:// URL and read their pixels back. Chrome is found at CHROME_PATH or in
 * its usual install folders.
 */
/* eslint-disable no-await-in-loop */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import {
    mkdtemp, readFile, rm, writeFile,
} from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const WIN_CHROME = ['Google', 'Chrome', 'Application', 'chrome.exe'];
const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']
        .map((key) => process.env[key] && path.join(process.env[key], ...WIN_CHROME)),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
    const found = CHROME_CANDIDATES.find((p) => existsSync(p));
    if (!found) throw new Error('Chrome not found: set CHROME_PATH to chrome.exe');
    return found;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function readDevToolsPort(profile, child, timeoutMs) {
    const file = path.join(profile, 'DevToolsActivePort');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (child.exitCode !== null) throw new Error(`Chrome exited early (code ${child.exitCode})`);
        try {
            const [port, wsPath] = (await readFile(file, 'utf8')).split(/\r?\n/);
            if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
        } catch {
            // not written yet
        }
        await sleep(50);
    }
    throw new Error('Chrome did not open its DevTools port');
}

/**
 * Opens one headless page. `width`/`height` set the window (the canvas work does not depend on it).
 * Returns { evaluate(expression), close() }; `evaluate` awaits promises and returns the value as JSON.
 */
export async function openHeadlessPage({ width = 640, height = 480, startTimeoutMs = 30000 } = {}) {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'sb-headless-'));
    const blank = path.join(profile, 'blank.html');
    await writeFile(blank, '<!doctype html><meta charset="utf-8"><body></body>', 'utf8');
    const child = spawn(findChrome(), [
        '--headless',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--disable-web-security',
        '--allow-file-access-from-files',
        '--force-device-scale-factor=1',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-component-update',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        'about:blank',
    ], { stdio: 'ignore' });

    let socket = null;
    const close = async () => {
        try {
            socket?.close();
        } catch {
            // already closed
        }
        if (child.exitCode === null) child.kill();
        for (let i = 0; i < 40 && child.exitCode === null; i += 1) await sleep(50);
        // Chrome lets go of its profile a moment after it exits.
        await rm(profile, {
            recursive: true, force: true, maxRetries: 10, retryDelay: 100,
        }).catch(() => {});
    };

    try {
        const url = await readDevToolsPort(profile, child, startTimeoutMs);
        socket = new WebSocket(url);
        await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
        });
        let nextId = 1;
        const pending = new Map();
        const waiters = [];
        socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
                else resolve(msg.result);
                return;
            }
            for (let i = waiters.length - 1; i >= 0; i -= 1) {
                if (waiters[i].method === msg.method && waiters[i].sessionId === msg.sessionId) {
                    waiters[i].resolve(msg.params);
                    waiters.splice(i, 1);
                }
            }
        });
        const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({
                id, method, params, ...(sessionId ? { sessionId } : {}),
            }));
        });
        const once = (method, sessionId) => new Promise((resolve) => { waiters.push({ method, sessionId, resolve }); });

        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        const loaded = once('Page.loadEventFired', sessionId);
        await send('Page.navigate', { url: pathToFileURL(blank).href }, sessionId);
        await loaded;

        const evaluate = async (expression) => {
            const { result, exceptionDetails } = await send('Runtime.evaluate', {
                expression, awaitPromise: true, returnByValue: true,
            }, sessionId);
            if (exceptionDetails) {
                const text = exceptionDetails.exception?.description || exceptionDetails.text;
                throw new Error(`page threw: ${text}`);
            }
            return result.value;
        };
        return { evaluate, close };
    } catch (error) {
        await close();
        throw error;
    }
}
