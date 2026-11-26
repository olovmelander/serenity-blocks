// Every Odyssey orb's goal moment in the real game, in a private headless Chrome.
//   node scripts/odyssey-goal-check.mjs <base url of a dev server> <out dir> [orbs, e.g. 1-60 or 8,21,42]
// For each orb it enters the orb, moves the goal's own counter through the rules (half way, then
// to the target; a duel by real knockouts), and reads what the player is shown: the HUD's count on
// the way and at the goal, its "Goal reached" label and stars, the words in the well, the stopped
// well, the results sheet and the save. Exit 1 unless every orb passes with a clean console.
// What it does not do is play: the board-to-counter step is covered by the unit tests and the
// campaign benchmark. No dependencies (Node 22+ has fetch and WebSocket); it stops only its own Chrome.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [baseUrl, outDir, orbArg = '1-60'] = process.argv.slice(2);
if (!baseUrl || !outDir) { console.error('usage: node scripts/odyssey-goal-check.mjs <base url> <out dir> [orbs]'); process.exit(2); }
const orbs = orbArg.split(',').flatMap((part) => {
    const [from, to = from] = part.split('-').map(Number);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
});
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
const chromePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && existsSync(p));
const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(path.join(os.tmpdir(), 'odyssey-goal-chrome-'));
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1', '--window-size=1600,1000',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

let socket;
for (let i = 0; i < 80 && !socket; i++) {
    try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = pages.find((p) => p.type === 'page');
        if (page) socket = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* Chrome is still starting */ }
    if (!socket) await sleep(250);
}
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
    } else if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params.exceptionDetails;
        errors.push(`uncaught: ${detail.exception?.description || detail.text}`.slice(0, 300));
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(`console.error: ${message.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
    }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
}
async function until(expression, seconds, what) {
    for (let i = 0; i < seconds * 5; i++) {
        if (await evaluate(`Boolean(${expression})`).catch(() => false)) return true;
        await sleep(200);
    }
    throw new Error(`timed out waiting for ${what}`);
}
async function key(code, vk) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code, windowsVirtualKeyCode: vk });
    await sleep(50);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code, windowsVirtualKeyCode: vk });
}
// Browser noise that is not the game's: no audio device, gesture or music codec in a headless tab.
const noise = (line) => /NotAllowedError|NotSupportedError|play\(\) failed|AudioContext|favicon/i.test(line);

// In-page helpers: the attempt, what the player is shown, and the goal's own counter.
const PAGE = `
window.__goal = {
    session: () => window.odysseyMode._activeLevelSession,
    level() {
        const l = this.session().levelConfig; const p = l.victory.primary;
        return { name: l.name, type: p.type, target: p.target, lap: l.victoryLapPolicy !== 'none', duel: Boolean(l.mechanics.versus) };
    },
    // The goal's counter as the rules hold it.
    count() {
        const s = this.session(); const m = s.hybridEngine.getMetrics(); const type = s.levelConfig.victory.primary.type;
        return { lines: m.lines, score: s.gameState.score, cascade: m.cascades, combo: m.maxCombo, quads: m.quads,
            rubble: m.rubbleCleared, time: Math.floor(m.time), frags: m.frags }[type];
    },
    set(value) {
        const mode = window.odysseyMode; const s = this.session(); const e = s.hybridEngine; const t = e.victoryEvaluator.trackedMetrics;
        const type = s.levelConfig.victory.primary.type;
        if (type === 'lines') t.lines = value;
        else if (type === 'score') s.gameState.score = value;
        else if (type === 'cascade') t.cascades = value;
        else if (type === 'combo') t.maxCombo = value;
        else if (type === 'quads') t.quads = value;
        else if (type === 'rubble') e.rubbleStart = e.getMetrics().rubbleLeft + value;
        else if (type === 'time') mode.levelStartTime -= Math.max(0, value * 1000 - mode._elapsedLevelMs());
        else throw new Error('no counter for ' + type);
    },
    seen() {
        const mode = window.odysseyMode; const s = this.session(); const hud = document.querySelector('.odyssey-hud');
        const text = (root, selector) => (root?.querySelector(selector)?.textContent || '').replace(/\\s+/g, ' ').trim();
        const shown = (node) => { if (!node || !node.isConnected) return false; const r = node.getBoundingClientRect(); const c = getComputedStyle(node);
            return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && Number(c.opacity) > 0.05; };
        const flow = document.getElementById('odyssey-flow-overlay'); const word = document.querySelector('.odyssey-goal-word');
        const results = document.querySelector('.sb-ody-modal, .sb-ody-sheet');
        const progress = text(hud, '.progress-value');
        const figures = progress.split('/').map((part) => Number(part.replace(/[^0-9]/g, '')));
        return {
            hud: shown(hud), goal: text(hud, '.objective-text'), label: text(hud, '.objective-section > .hud-label'), progress,
            current: progress.includes('/') ? figures[0] : null, of: progress.includes('/') ? figures[1] : null,
            bar: hud?.querySelector('.progress-fill')?.style.width || '', starsLit: hud ? hud.querySelectorAll('.star-row.earned').length : null,
            reached: Boolean(hud?.classList.contains('is-goal-reached')), lap: Boolean(hud?.classList.contains('is-victory-lap')),
            duelScore: text(hud, '[data-player-frags]'), word: shown(word) ? [...word.children].map((n) => n.textContent.replace(/\\s+/g, ' ').trim()).join(' / ') : null,
            banner: shown(document.getElementById('goal-complete-overlay')) ? text(document, '#goal-complete-overlay .goal-complete-title') : null,
            completing: Boolean(mode.levelCompleting), goalComplete: Boolean(s?.gameState?.goalComplete), retired: Boolean(s?.retired),
            piece: Boolean(s?.gameState?.currentPiece), stopped: Boolean(s?.gameState?.isStopped), raf: s?.gameState?.animationId ?? null,
            simMs: Math.round(s?.gameState?.simTimeMs || 0), engineStars: s?.hybridEngine?.calculateStars?.() ?? null, count: s ? this.count() : null,
            sheet: shown(flow) ? text(flow, '.ody-flow__eyebrow, [class*="eyebrow"]') + ' | ' + flow.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : null,
            sheetStars: shown(flow) ? flow.querySelectorAll('.ody-flow__stars .is-earned').length : null,
            results: shown(results) ? results.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : null,
            failure: shown(document.getElementById('odyssey-failure-modal')),
            saved: s ? { done: mode.odysseyState.isLevelCompleted(s.levelId), stars: mode.odysseyState.getLevelStars(s.levelId) } : null,
        };
    },
};`;

async function playOrb(orb) {
    const entry = { orb, checks: {} };
    const check = (name, pass, detail) => { entry.checks[name] = pass ? true : `FAILED${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`; };
    await send('Page.navigate', { url: `${baseUrl}/?skipIntro=1&unlockAll=1&odysseyDebug=1&maxFps=30` });
    await until("window.serenityBlocks && document.querySelector('#start-modal.visible') && !document.querySelector('#startup-shell')", 180, 'the start menu');
    await evaluate('window.serenityBlocks.settingsManager.update({ targetFrameRate: 30 })');
    await evaluate("window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'odyssey' } }))");
    await until('window.odysseyMode && window.testOdysseyLevel', 180, 'the Odyssey map');
    // A fresh journey is welcomed first: keep the map (Esc), then enter the orb.
    if (await evaluate('Boolean(window.odysseyMode.odysseyState?.isFreshJourney?.())')) {
        await until('window.odysseyMode._firstArrival', 12, 'the first arrival').catch(() => {});
        if (await evaluate('Boolean(window.odysseyMode._firstArrival)')) {
            await sleep(1000);
            await key('Escape', 27);
            await until('!window.odysseyMode._firstArrival', 15, 'the arrival to close');
        }
    }
    await sleep(1200);
    await evaluate(`void window.testOdysseyLevel(${orb})`);
    await until(`window.odysseyMode.currentLevelId === ${orb} && window.odysseyMode.levelRunStarted && window.odysseyMode._activeLevelSession?.gameState?.currentPiece`, 180, 'the orb to start');
    await evaluate(PAGE);
    await sleep(700);
    const level = await evaluate('window.__goal.level()');
    entry.level = level;
    const seen = () => evaluate('window.__goal.seen()');
    const start = await seen();
    check('the HUD names the goal', start.hud && start.goal.length > 3 && start.label === 'Goal', { goal: start.goal, label: start.label });
    if (!level.duel) check('the count starts at 0 of the target', start.current === 0 && start.of === level.target, start.progress);

    if (level.duel) {
        // Real knockouts: the rival's well ends, the round resets, the scoreboard counts.
        for (let knockout = 1; knockout <= level.target; knockout++) {
            await until('!window.__goal.session().duel.pendingDeaths.size && !(window.__goal.session().duel.intermissionMs > 0) && !window.__goal.session().duel.transition', 30, 'the round');
            await sleep(600);
            await evaluate('window.__goal.session().duel.markTopOut(1)');
            await until(`window.__goal.session().duel.multiplayer.frags[0] >= ${knockout}`, 30, `knockout ${knockout}`);
            if (knockout < level.target) {
                await sleep(500);
                const mid = await seen();
                check(`the scoreboard shows knockout ${knockout}`, mid.duelScore === String(knockout), mid.duelScore);
            }
        }
    } else if (level.type === 'time') {
        // The clock moved to just short of the target: no piece lands, no tide rises before the goal.
        await evaluate(`window.__goal.set(${level.target} - 0.9)`);
        await sleep(350);
        const mid = await seen();
        check('the count follows the clock', mid.current === level.target - 1 && mid.of === level.target, mid.progress);
    } else {
        const half = Math.max(1, Math.floor(level.target / 2));
        if (half < level.target) {
            await evaluate(`window.__goal.set(${half})`);
            await sleep(450);
            const mid = await seen();
            check('the count follows the goal half way', mid.current === half && mid.of === level.target && !mid.completing, mid.progress);
        }
        await evaluate(`window.__goal.set(${level.target})`);
    }
    await until('window.odysseyMode.levelCompleting || window.__goal.session()?.gameState?.goalComplete', 30, 'the goal');
    await sleep(350);

    const shoot = async (suffix = '') => {
        const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 62 });
        writeFileSync(path.join(outDir, `orb-${String(orb).padStart(2, '0')}${suffix}.jpg`), Buffer.from(shot.data, 'base64'));
    };
    let goal;
    if (level.lap) {
        // A showcase lap: the goal is announced and play goes on until Finish; the sheet follows at once.
        goal = await seen();
        await shoot();
        check('the lap says the goal is complete', goal.lap && goal.progress === 'Complete' && goal.banner === 'Goal complete' && !goal.completing,
            { lap: goal.lap, progress: goal.progress, banner: goal.banner });
        check('the HUD lights the stars the rules award', goal.engineStars >= 1 && goal.starsLit === goal.engineStars,
            { lit: goal.starsLit, awarded: goal.engineStars });
        await key('Enter', 13);
        await until('window.odysseyMode.levelCompleting', 20, 'the lap to finish');
        await sleep(300);
        const finished = await seen();
        goal.engineStars = finished.engineStars;
        check('the finished well is stopped', finished.retired && finished.stopped && finished.raf === null, { stopped: finished.stopped, raf: finished.raf });
    } else {
        goal = await seen();
        await shoot();
        check('the orb is completing', goal.completing && goal.retired && !goal.failure);
        check('the HUD says the goal is reached', goal.hud && goal.reached && goal.label === 'Goal reached', { reached: goal.reached, label: goal.label });
        if (level.duel) check('the scoreboard stands at the target', goal.duelScore === String(level.target), goal.duelScore);
        else {
            check('the count stands at its goal', goal.current >= level.target && goal.of === level.target && goal.count >= level.target,
                { progress: goal.progress, count: goal.count });
            check('the bar is full', goal.bar === '100%', goal.bar);
            check('the next piece left the well', !goal.piece);
        }
        check('the well says the goal is reached', Boolean(goal.word?.startsWith('Goal reached / ') && goal.word.endsWith(start.goal)), goal.word);
        check('the HUD lights the stars the rules award', goal.engineStars >= 1 && goal.starsLit === goal.engineStars,
            { lit: goal.starsLit, awarded: goal.engineStars });
        check('the finished well is stopped', goal.stopped && goal.raf === null, { stopped: goal.stopped, raf: goal.raf });
        await sleep(900);
        const later = await seen();
        check('the finished attempt no longer runs', later.raf === null && later.simMs === goal.simMs, { raf: later.raf, before: goal.simMs, after: later.simMs });
    }
    entry.goal = goal;

    await until("(() => { const s = window.__goal.seen(); return s.sheet || s.results; })()", 25, 'the results');
    await sleep(400);
    const sheet = await seen();
    entry.sheet = { sheet: sheet.sheet, results: sheet.results, sheetStars: sheet.sheetStars, saved: sheet.saved };
    if (sheet.sheet) {
        check('the sheet names the orb complete', /Complete/i.test(sheet.sheet) && sheet.sheet.includes(String(orb)), sheet.sheet);
        check('the sheet shows the awarded stars', sheet.sheetStars === goal.engineStars, { sheet: sheet.sheetStars, awarded: goal.engineStars });
    } else check('a results sheet is shown', Boolean(sheet.results), sheet.results);
    check('the clear is saved with its stars', sheet.saved?.done === true && sheet.saved.stars === goal.engineStars, sheet.saved);
    return entry;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const report = [];
let failed = 0;
try {
    for (const orb of orbs) {
        errors = [];
        let entry;
        try { entry = await playOrb(orb); } catch (error) { entry = { orb, error: String(error.message || error), checks: {} }; }
        if (entry.error) {
            const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 62 }).catch(() => null);
            if (shot) writeFileSync(path.join(outDir, `orb-${String(orb).padStart(2, '0')}-error.jpg`), Buffer.from(shot.data, 'base64'));
        }
        entry.errors = errors.filter((line) => !noise(line));
        const bad = Object.entries(entry.checks).filter(([, pass]) => pass !== true);
        const ok = !entry.error && !entry.errors.length && !bad.length && Object.keys(entry.checks).length > 0;
        if (!ok) failed++;
        report.push(entry);
        writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
        const goalType = entry.level ? `${entry.level.type} ${entry.level.target}${entry.level.lap ? ' lap' : ''}` : '';
        console.log(`orb ${String(orb).padStart(2)} ${goalType.padEnd(16)} ${ok ? 'ok' : 'FAILED'}`
            + `${entry.goal ? ` · HUD ${entry.goal.duelScore && entry.level.duel ? `${entry.goal.duelScore} knockouts` : entry.goal.progress} · ${entry.goal.starsLit} stars` : ''}`
            + `${entry.error ? ` · ${entry.error}` : ''}${bad.length ? ` · ${bad.map(([name, why]) => `${name} ${why}`).join('; ')}` : ''}`
            + `${entry.errors.length ? ` · console: ${entry.errors[0]}` : ''}`);
        await send('Page.navigate', { url: 'about:blank' });
        await sleep(800);
    }
} finally {
    socket.close();
    chrome.kill();
    await sleep(800);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
console.log(`${report.length - failed} of ${report.length} orbs passed`);
process.exit(failed ? 1 : 0);
