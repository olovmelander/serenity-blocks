// Level design pass 4: each rival orb in the real game, in a private headless Chrome at 30 fps.
//   node real-game-check.mjs <base url of a private dev server> <out dir> [orbs, default the eight rivals]
// For every orb it reads the map card, enters the duel, reads the HUD (goal, guide, the three star lines,
// the rival's label), the duel's own rules and the rival's settings, presses real keys, and collects
// every console error. Exit 1 unless every orb matches its level data and the console stayed clean.
// No dependencies: Node 22+ has fetch and WebSocket. It stops only the Chrome it started.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [baseUrl, outDir, orbArg = '5,10,18,26,34,48,56,60'] = process.argv.slice(2);
if (!baseUrl || !outDir) { console.error('usage: node real-game-check.mjs <base url> <out dir> [orbs]'); process.exit(2); }
const orbs = orbArg.split(',').map(Number);
mkdirSync(outDir, { recursive: true });
const chromePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(os.tmpdir(), 'pass4-chrome-'));
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1', '--window-size=1280,720',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

async function connect() {
    for (let i = 0; i < 80; i++) {
        try {
            const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            const page = pages.find((p) => p.type === 'page');
            if (page) return new WebSocket(page.webSocketDebuggerUrl);
        } catch { /* Chrome is still starting */ }
        await sleep(250);
    }
    throw new Error('Chrome did not open a page');
}

const socket = await connect();
await new Promise((done) => { socket.addEventListener('open', done, { once: true }); });
let nextId = 1;
const waiting = new Map();
let errors = [];
socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
        const { resolve, reject } = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
        return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params.exceptionDetails;
        errors.push(`uncaught: ${detail.exception?.description || detail.text}`.slice(0, 300));
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(`console.error: ${message.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        errors.push(`log: ${message.params.entry.text} ${message.params.entry.url || ''}`.slice(0, 300));
    }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression, awaitPromise = true) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
}
async function until(expression, seconds, what) {
    for (let i = 0; i < seconds * 4; i++) {
        if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
        await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
}
async function key(code, keyText, vk) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyText, windowsVirtualKeyCode: vk });
    await sleep(60);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyText, windowsVirtualKeyCode: vk });
}
// Browser noise that is not the game's: no audio device or gesture in a headless tab.
const noise = (line) => /NotAllowedError|play\(\) failed|AudioContext|favicon/i.test(line);

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
const report = [];
let failed = false;
try {
    for (const orb of orbs) {
        errors = [];
        const entry = { orb };
        try {
            await send('Page.navigate', { url: `${baseUrl}/?skipIntro=1&unlockAll=1&odysseyDebug=1&maxFps=30` });
            await until("window.serenityBlocks && document.querySelector('#start-modal.visible') && !document.querySelector('#startup-shell')", 120, 'the start menu');
            await evaluate('window.serenityBlocks.settingsManager.update({ targetFrameRate: 30 })');
            await evaluate("window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'odyssey' } }))");
            await until('window.odysseyMode && window.testOdysseyLevel', 120, 'the Odyssey map');
            await sleep(2500);
            entry.level = await evaluate(`(() => { const l = window.odysseyMode.levelRegistry.getLevel(${orb}); const v = l.mechanics.versus;
                return { name: l.name, subtitle: l.metadata.subtitle, tier: v.botDifficulty, botName: v.botName, knockouts: v.fragsToWin,
                    hands: v.botOverrides, judgment: v.botJudgment ?? null, stars: l.stars, gravity: l.mechanics.speed.fixedDropInterval }; })()`);
            await evaluate(`window.odysseyMode._updateLevelPreview(${orb})`);
            await sleep(600);
            entry.card = await evaluate("(document.getElementById('odyssey-level-panel')?.textContent || '').replace(/\\s+/g, ' ').trim()");
            await evaluate(`void window.testOdysseyLevel(${orb})`, false);
            await until("window.odysseyMode._activeLevelSession?.duel && document.querySelector('.odyssey-hud .objective-text')?.textContent", 150, 'the duel');
            await until('window.odysseyMode._activeLevelSession.duel.players[1].piecesPlaced > 0', 60, "the rival's first piece");
            for (const [code, text, vk] of [['ArrowLeft', 'ArrowLeft', 37], ['Space', ' ', 32], ['ArrowRight', 'ArrowRight', 39],
                ['ArrowRight', 'ArrowRight', 39], ['Space', ' ', 32], ['ArrowUp', 'ArrowUp', 38], ['Space', ' ', 32], ['Space', ' ', 32]]) {
                await key(code, text, vk);
                await sleep(450);
            }
            await sleep(4000);
            entry.game = await evaluate(`(() => {
                const mode = window.odysseyMode; const duel = mode._activeLevelSession.duel; const hud = document.querySelector('.odyssey-hud');
                const text = (selector) => (hud.querySelector(selector)?.textContent || '').replace(/\\s+/g, ' ').trim();
                return {
                    goal: text('.objective-text'), guide: text('.level-guide'), label: (document.querySelector('.odyssey-duel-opponent__skill')?.textContent || '').trim(),
                    stars: [...hud.querySelectorAll('.star-requirement')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()),
                    snapshot: (({ difficulty, botName, targetFrags, round }) => ({ difficulty, botName, targetFrags, round }))(duel.getSnapshot()),
                    wells: duel.players.map((p) => ({ pieces: p.pieceRandomizer, lock: p.lockStyle, placed: p.piecesPlaced, gravity: p.dropInterval })),
                    rival: { versusPlay: Boolean(duel.bot.versusWeights), tier: duel.bot.config.tier, maxApm: duel.bot.config.maxApm,
                        reactionMs: duel.bot.config.reactionMs, planUnitsPerMs: duel.bot.planUnitsPerMs, frozen: duel.frozenRival },
                };
            })()`);
            const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
            writeFileSync(path.join(outDir, `orb-${orb}.jpg`), Buffer.from(shot.data, 'base64'));
            const { level, game } = entry;
            entry.checks = {
                'HUD goal names the rival and the knockouts': game.goal.includes(level.botName) && game.goal.includes(String(level.knockouts)),
                'label is the rival and its tier': game.label === level.subtitle && game.snapshot.difficulty === level.tier,
                'three star lines': game.stars.length === 3 && game.stars.every(Boolean),
                'guide tells the duel rules': /any order/.test(game.guide) && /tops out/.test(game.guide),
                'card names the orb': entry.card.includes(`Orb ${orb}`),
                'both wells: pieces one by one, lock at the next step': game.wells.every((w) => w.pieces === 'random' && w.lock === 'gravity'),
                'both wells at the duel gravity': game.wells.every((w) => w.gravity === level.gravity),
                'rival plays the versus play at its tier and hands': game.rival.versusPlay && !game.rival.frozen && game.rival.tier === level.tier
                    && game.rival.maxApm === level.hands.maxApm && String(game.rival.reactionMs) === String(level.hands.reactionMs),
                'the player and the rival both placed pieces': game.wells.every((w) => w.placed > 0),
            };
        } catch (error) { entry.error = String(error.message || error); }
        entry.errors = errors.filter((line) => !noise(line));
        const ok = !entry.error && entry.errors.length === 0 && Object.values(entry.checks || { none: false }).every(Boolean);
        if (!ok) failed = true;
        report.push(entry);
        const bad = Object.entries(entry.checks || {}).filter(([, pass]) => !pass).map(([name]) => name);
        console.log(`orb ${orb}: ${ok ? 'ok' : 'FAILED'}${entry.error ? ` · ${entry.error}` : ''}${bad.length ? ` · ${bad.join('; ')}` : ''}${entry.errors.length ? ` · ${entry.errors.length} console errors` : ''}`);
        await send('Page.navigate', { url: 'about:blank' });
        await sleep(1500);
    }
} finally {
    writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
    socket.close();
    chrome.kill();
    await sleep(800);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
process.exit(failed ? 1 : 0);
