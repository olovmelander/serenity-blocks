// Online versus soak: N windows of one Chromium on the mock transport, a bot in each, a
// chosen network; then a report of what each player experienced.
//
//   npm run dev                              (the dev server, http://localhost:5173)
//   node scripts/mp-soak.mjs --out=artifacts/mp-soak/lossy --players=2 --seconds=45 --impair="netImpair=lossy"
//   node scripts/mp-soak.mjs --report=artifacts/mp-soak/lossy
//
// Options: --players (2-8), --seconds (bot play), --impair (URL query for the impairment
// harness: netImpair=lossy|badwifi|burst|1, netDelay=a-b, netLoss=…; see
// src/core/network/network-impairment.js), --extra (more URL query, e.g. flags),
// --base (dev server URL), --chrome (a Chromium binary when Playwright's own is missing).
//
// Per window it records the own board's changes, every opponent board it displays, 16 probe
// key presses (applied inside the keydown event or not), frame times, long tasks, packet
// stats, the host's net events with reasons, and why inbound messages failed validation.
// The report derives input-to-board time, how late each player first sees each other board,
// flicker (an older board shown again after a newer one), own-board corrections, resyncs and
// rejected inputs.
//
// Numbers from a software-rendered container are inflated: compare runs with each other
// (same machine, same seed), never with hardware targets (ADR-0016).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.join('=') || true];
}));

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
        return createRequire(path.join(root, '/'))('playwright');
    }
}

// ---------------------------------------------------------------------------------------
// In-page instrumentation (runs in every window once the match is live)
// ---------------------------------------------------------------------------------------
function instrumentPage() {
    const ffa = window.__getFfa?.();
    if (!ffa) return { local: null, joinFailed: true };
    const local = ffa.localPlayerId;
    const signature = (grid) => {
        if (!Array.isArray(grid)) return null;
        let cells = 0;
        let hash = 2166136261;
        for (let r = 0; r < grid.length; r++) {
            const row = grid[r];
            if (!Array.isArray(row)) continue;
            for (let c = 0; c < row.length; c++) {
                if (row[c]) {
                    cells++;
                    hash = Math.imul(hash ^ (r * 16 + c), 16777619) >>> 0;
                }
            }
        }
        return `${cells}:${hash}`;
    };
    const M = {
        local, own: [], seen: {}, frames: 0, frameTimes: [], longTasks: [], lat: [], sync: [], valFails: {},
    };
    window.__mpSoak = M;

    // Own board: the truth timeline of this player's board.
    let lastOwn = null;
    setInterval(() => {
        const gs = ffa.getLocalPlayer?.()?.gameState;
        const sig = signature(gs?.boardGrid || gs?.grid);
        if (sig && sig !== lastOwn) {
            lastOwn = sig;
            M.own.push([Date.now(), sig]);
        }
        if (M.pendingKey) {
            const x = gs?.currentPiece?.x;
            if (x !== undefined && x !== M.pendingKey.x0) {
                M.lat.push(performance.now() - M.pendingKey.t);
                M.pendingKey = null;
            } else if (performance.now() - M.pendingKey.t > 500) {
                M.lat.push(-1);
                M.pendingKey = null;
            }
        }
    }, 2);

    // Opponent boards as displayed: wrap the watch manager's feed.
    const lastSeen = {};
    const wrapWatch = () => {
        const owm = window.__getMode?.()?.opponentWatchManager;
        if (!owm || owm.__mpSoakWrapped) return;
        const original = owm.updateFromState.bind(owm);
        owm.updateFromState = (states) => {
            const now = Date.now();
            for (const state of states || []) {
                const id = String(state?.id ?? state?.steamId);
                const sig = signature(state?.grid || state?.gameState?.boardGrid);
                if (sig && lastSeen[id] !== sig) {
                    lastSeen[id] = sig;
                    (M.seen[id] = M.seen[id] || []).push([now, sig]);
                }
            }
            return original(states);
        };
        owm.__mpSoakWrapped = true;
    };
    wrapWatch();
    setInterval(wrapWatch, 500);

    // Why inbound envelopes fail validation (replay = at or below the last sequence seen).
    const net = ffa.network;
    if (net && !net.__mpSoakWrapped) {
        const validate = net._validateEnvelope.bind(net);
        net._validateEnvelope = (envelope, from, channel, options) => {
            const key = `${from}:${envelope?.channel ?? channel}`;
            const last = net.recvSeqByPeer?.get?.(key) ?? -1;
            const ok = validate(envelope, from, channel, options);
            if (!ok) {
                const why = typeof envelope?.seq === 'number' && envelope.seq <= last ? 'replay' : 'other';
                const k = `${envelope?.msgType}|ch${envelope?.channel ?? channel}|${why}`;
                M.valFails[k] = (M.valFails[k] || 0) + 1;
            }
            return ok;
        };
        net.__mpSoakWrapped = true;
    }

    const tick = (t) => {
        M.frames++;
        M.frameTimes.push(t);
        if (M.frameTimes.length > 20000) M.frameTimes.shift();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) M.longTasks.push(Math.round(entry.duration));
        }).observe({ type: 'longtask', buffered: false });
    } catch { /* no long-task timing in this browser */ }

    // Probe: was a left/right press applied inside its own keydown event?
    document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            M.pendingKey = { t: performance.now(), x0: ffa.getLocalPlayer?.()?.gameState?.currentPiece?.x };
        }
    }, true);
    window.addEventListener('keydown', (event) => {
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && M.pendingKey) {
            M.sync.push(ffa.getLocalPlayer?.()?.gameState?.currentPiece?.x !== M.pendingKey.x0);
        }
    }, false);
    return { local, players: [...ffa.players.keys()] };
}

function startBot() {
    let n = 0;
    window.__mpSoakBot = setInterval(() => {
        n++;
        const r = Math.random();
        try {
            if (n % 6 === 0) window.hardDrop?.();
            else if (r < 0.45) window.move?.(Math.random() < 0.5 ? -1 : 1);
            else if (r < 0.7) window.rotate?.('right');
            else window.softDrop?.();
        } catch { /* the board may be between rounds */ }
    }, 140);
}

function collectPage() {
    const M = window.__mpSoak;
    const ffa = window.__getFfa?.();
    if (!M || !ffa) return { joinFailed: true };
    const gaps = [];
    for (let i = 1; i < M.frameTimes.length; i++) gaps.push(M.frameTimes[i] - M.frameTimes[i - 1]);
    return {
        local: M.local,
        own: M.own,
        seen: M.seen,
        lat: M.lat,
        sync: M.sync,
        longTasks: M.longTasks,
        valFails: M.valFails,
        frames: M.frames,
        gaps,
        packetStats: ffa.network?.getPacketStats?.() || null,
        phase: ffa.gamePhase,
        netEvents: (ffa._netEventLog || []).map((e) => e.type + (e.data?.reason ? `:${e.data.reason}` : '')),
    };
}

// ---------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------
async function run() {
    const out = String(args.out || path.join('artifacts', 'mp-soak', 'run'));
    const players = Math.max(2, Math.min(8, Number(args.players || 2)));
    const seconds = Number(args.seconds || 45);
    const base = String(args.base || 'http://localhost:5173');
    const query = (s) => (typeof s === 'string' && s ? `&${s}` : '');
    const { chromium } = await loadPlaywright();
    const launch = {
        args: [
            '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
            '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
        ],
    };
    if (args.chrome) launch.executablePath = String(args.chrome);
    const browser = await chromium.launch(launch);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const pages = [];
    const logs = [];
    const open = async (role, index) => {
        const page = await context.newPage();
        const tag = index === 0 ? 'host' : `p${index}`;
        page.on('pageerror', (error) => logs.push({ tag, kind: 'pageerror', text: error.message.slice(0, 300) }));
        page.on('console', (message) => {
            const text = message.text();
            if (text.startsWith('📡 [NET]')) logs.push({ tag, kind: 'net', text });
            else if (message.type() === 'error' && !/Music switch|play\(\) failed|favicon/.test(text)) {
                logs.push({ tag, kind: 'console-error', text: text.slice(0, 300) });
            } else if (/desync|divergence|migrat|rejected|timeout/i.test(text) && !/Mock (sent|received)/.test(text)) {
                logs.push({ tag, kind: 'console', text: text.slice(0, 240) });
            }
        });
        await page.goto(`${base}/?skipIntro=1${role ? `&localMp=${role}` : ''}${query(args.impair)}${query(args.extra)}`,
            { waitUntil: 'domcontentloaded' });
        pages.push({ page, tag });
        return page;
    };

    const host = await open('', 0);
    await host.waitForTimeout(6000);
    await host.evaluate((n) => window.localMpHost({ autoStart: false, maxPlayers: n }), players);
    await host.waitForTimeout(1500);
    for (let i = 1; i < players; i++) {
        await open('join', i);
        await host.waitForTimeout(2500);
    }
    for (let i = 0; i < 60; i++) {
        if ((await host.evaluate(() => window.__getFfa?.()?.players?.size || 0)) >= players) break;
        await host.waitForTimeout(1000);
    }
    const startedAt = Date.now();
    await host.evaluate(() => {
        const mode = window.__getMode();
        const config = mode.ffaGameState.matchConfig;
        config.endCondition = 'frags';
        config.endConditionValue = 99; // rounds end, the match does not
        mode.ffaGameState?.setReady?.(true);
    });
    for (const { page, tag } of pages) {
        if (tag !== 'host') await page.evaluate(() => window.__getFfa?.()?.setReady?.(true)).catch(() => {});
    }
    await host.waitForTimeout(1000);
    await host.evaluate(() => window.__getMode().lobbyWaitingRoom?.startMatch?.());
    for (let i = 0; i < 60; i++) {
        const phases = await Promise.all(pages.map(({ page }) => page.evaluate(() => window.__getFfa?.()?.gamePhase || null).catch(() => null)));
        if (phases.every((phase) => phase === 'playing')) break;
        await host.waitForTimeout(500);
    }
    const startupMs = Date.now() - startedAt;
    await host.waitForTimeout(1500);

    const ids = [];
    for (const { page, tag } of pages) ids.push({ tag, ...(await page.evaluate(instrumentPage).catch((e) => ({ error: e.message }))) });
    const live = pages.filter((_, i) => !ids[i].joinFailed && !ids[i].error);
    for (let k = 0; k < 16; k++) {
        for (const { page } of live) await page.keyboard.press(k % 2 ? 'ArrowLeft' : 'ArrowRight');
        await host.waitForTimeout(260);
    }
    for (const { page } of live) await page.evaluate(startBot);
    await host.waitForTimeout(seconds * 1000);
    for (const { page } of live) await page.evaluate(() => clearInterval(window.__mpSoakBot)).catch(() => {});
    await host.waitForTimeout(1500);

    const results = [];
    for (const { page, tag } of pages) results.push({ tag, ...(await page.evaluate(collectPage).catch((e) => ({ error: e.message }))) });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify({
        players, seconds, impair: query(args.impair).slice(1), extra: query(args.extra).slice(1), startupMs, ids, results, logs,
    }));
    await browser.close();
    console.log(`wrote ${path.join(out, 'raw.json')} (startup ${startupMs} ms)`);
    report(out);
}

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------
function report(dir) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'raw.json'), 'utf8'));
    const pct = (values, p) => {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]);
    };
    const fmt = (values) => (values.length
        ? `n=${values.length} p50=${pct(values, 0.5)} p90=${pct(values, 0.9)} p99=${pct(values, 0.99)} max=${Math.round(Math.max(...values))}`
        : 'n=0');
    const results = raw.results.filter((r) => !r.joinFailed && !r.error);
    console.log(`players=${raw.players} seconds=${raw.seconds} impair="${raw.impair}" extra="${raw.extra}" startup=${raw.startupMs}ms`);
    raw.results.filter((r) => r.joinFailed || r.error).forEach((r) => console.log(`!! ${r.tag} never reached the match (${r.error || 'no game state'})`));

    console.log('\n# Own input -> own piece moved (ms; -1 = no move within 500 ms), and presses applied inside their keydown');
    for (const r of results) {
        const ok = (r.lat || []).filter((x) => x >= 0);
        const sync = r.sync || [];
        console.log(`${r.tag}: ${fmt(ok)} missed=${(r.lat || []).length - ok.length} inEvent=${sync.filter(Boolean).length}/${sync.length}`);
    }

    console.log('\n# How late each board change is first seen (ms), source -> observer; flicker = an older board shown after a newer one');
    for (const src of results) {
        for (const obs of results) {
            if (obs === src) continue;
            const seen = obs.seen?.[src.local] || [];
            const truth = src.own || [];
            const lags = [];
            let unmatched = 0;
            let flicker = 0;
            let prev = -1;
            const first = new Map();
            for (const [t, sig] of seen) {
                let index = -1;
                for (let i = truth.length - 1; i >= 0; i--) {
                    const [tt, ss] = truth[i];
                    if (tt > t + 50) continue;
                    if (t - tt > 5000) break;
                    if (ss === sig) { index = i; break; }
                }
                if (index < 0) { unmatched++; continue; }
                if (index < prev) flicker++;
                prev = Math.max(prev, index);
                if (!first.has(index)) { first.set(index, t); lags.push(t - truth[index][0]); }
            }
            console.log(`${src.tag} -> ${obs.tag}: ${fmt(lags)} flicker=${flicker} unmatched=${unmatched}/${seen.length} neverShown=${truth.length - first.size}`);
        }
    }

    console.log('\n# Own board: changes (how much each player got to play) and corrections (returns to an earlier board)');
    for (const r of results) {
        const own = r.own || [];
        const lastIndex = new Map();
        let corrections = 0;
        own.forEach(([, sig], i) => {
            if (lastIndex.has(sig) && i - lastIndex.get(sig) >= 2 && sig.split(':')[0] !== '0') corrections++;
            lastIndex.set(sig, i);
        });
        console.log(`${r.tag}: changes=${own.length} corrections=${corrections}`);
    }

    console.log('\n# Frames (ms between animation frames) and long tasks (ms)');
    for (const r of results) {
        const gaps = r.gaps || [];
        console.log(`${r.tag}: ${fmt(gaps)} >50ms=${gaps.filter((g) => g > 50).length} | longTasks ${fmt(r.longTasks || [])}`);
        // A window the browser throttled (hidden or starved) plays slow motion: say so.
        if (pct(gaps, 0.9) > 250) console.log(`!! ${r.tag}'s frames were throttled: discard this run`);
    }

    console.log('\n# Host net events (type:reason), packet stats, and inbound validation failures');
    for (const r of results) {
        const events = {};
        for (const e of r.netEvents || []) events[e] = (events[e] || 0) + 1;
        const ps = r.packetStats || {};
        console.log(`${r.tag}: received=${ps.received} decodeFailures=${ps.decodeFailures} validationFailures=${ps.validationFailures}`
            + ` resyncRequestsSent=${ps.resyncRequestsSent} aheadOfBaselineDeltas=${ps.aheadOfBaselineDeltas}`);
        if (Object.keys(events).length) console.log(`  events ${JSON.stringify(events)}`);
        if (r.valFails && Object.keys(r.valFails).length) console.log(`  validation ${JSON.stringify(r.valFails)}`);
    }

    console.log('\n# Errors and notable console lines');
    const counts = {};
    for (const entry of raw.logs.filter((l) => l.kind !== 'net')) {
        const key = `${entry.tag} ${entry.kind}: ${entry.text.slice(0, 140)}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    Object.entries(counts).slice(0, 40).forEach(([key, n]) => console.log(`${n}× ${key}`));
}

if (args.report) report(String(args.report));
else await run();
