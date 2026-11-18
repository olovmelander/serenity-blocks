// Real Chromium IndexedDB, cache and focus behavior, using disposable Steam fixtures.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = path.resolve(__dirname, '../src');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'serenity-records-smoke-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname;
    if (route === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><main></main>');
        return;
    }
    const file = path.resolve(src, '.' + route.slice(4));
    if (!route.startsWith('/src/') || !file.startsWith(src + path.sep) || !file.endsWith('.js') || !fs.existsSync(file)) {
        response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', 'text/javascript');
    fs.createReadStream(file).pipe(response);
});

async function exercise(phase) {
    const check = (ok, label) => { if (!ok) throw new Error(phase + ': ' + label); };
    const wait = async (fn, label) => {
        for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
        throw new Error(phase + ': ' + label);
    };
    const { HighScoreManager } = await import('/src/ui/high-scores.js');
    const { default: steam } = await import('/src/core/steam/steam-service.js');
    const { SteamLeaderboardPanel, modeBoards } = await import('/src/ui/components/steam-leaderboard-panel.js');
    const manager = new HighScoreManager();
    if (phase === 'other-account') {
        check((await manager.getStatistics()).totalGames === 0, 'isolated account');
        return;
    }
    Object.assign(steam, { appId: 123456, steamId: '101', initialized: true, initComplete: true, isOnline: phase === 'online' });
    steam.capabilities.leaderboards = true;
    steam.records.manager = manager;
    const uploads = [];
    steam.records.invoke = async (channel, payload) => { uploads.push([channel, payload]); return { success: true }; };
    if (phase === 'online') {
        const receipt = { mode: 'single', owner: steam.records.owner, score: 1200, lines: 8, level: 2, duration: 60 };
        const data = { runId: 'finish', receipt, score: 1200, lines: 8, level: 2 };
        await manager.addScore(data);
        await manager.addScore(data);
        const store = manager._storeScore.bind(manager);
        manager._storeScore = async () => { throw new Error('test transaction interruption'); };
        localStorage.setItem('serenity.pendingRun/damaged', '{');
        await manager.addScore({ ...data, runId: 'interrupted' }).catch(() => {});
        manager._storeScore = store;
        await manager.recoverPendingRuns();
        check((await manager.getStatistics()).totalGames === 2, 'a damaged journal entry cannot block the intact finish');
        check(localStorage.getItem('serenity.pendingRun/damaged') === '{', 'damaged journal retained');
        check(localStorage.getItem('serenity.pendingRun/interrupted') === null, 'intact journal committed');
        await steam.records.flush();
        check(!uploads.length, 'no public writes before consent');
        steam.getLeaderboard = async (_name, view) => ({ supported: true, entries: [
            { rank: 1, steamId: '102', name: view === 'friends' ? 'A friend' : 'Global player', score: 5000 },
        ] });
        steam.getLeaderboardEntry = async () => ({ rank: 37, steamId: '101', name: 'You', score: 1200 });
    } else {
        check((await manager.getTopScores(10)).length === 2, 'offline records after restart');
        steam.getLeaderboard = () => { throw new Error('offline access'); };
    }
    const host = document.querySelector('main');
    const panel = new SteamLeaderboardPanel({ boards: modeBoards('single') });
    panel.mount(host);
    await wait(() => host.textContent.includes('Global player') && host.textContent.includes('#37'), 'cached or live top and personal rank');
    if (phase === 'online') {
        host.querySelector('[data-view-id="friends"]').click();
        await wait(() => host.textContent.includes('A friend'), 'friends view');
        const choose = (text) => [...host.querySelectorAll('button')].find((button) => button.textContent === text);
        await wait(() => choose('Share scores'), 'consent control');
        choose('Share scores').click();
        await steam.records.flush();
        check(uploads.filter(([channel]) => channel === 'steam:uploadScore').length === 2, 'best scores shared after opt-in');
        check(document.activeElement.textContent === 'Stop sharing', 'controller focus after choice');
        choose('Stop sharing').click();
        await steam.records.flush();
        host.querySelector('[data-view-id="global"]').click();
        await wait(() => host.textContent.includes('Global player'), 'latest global page');
    } else check(host.textContent.includes('offline'), 'offline status');
    panel.destroy();
}

(async () => {
    await app.whenReady();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    // The shipped game uses file URLs. Prove that the read-only importer reaches the
    // original Chromium partition and origin after the Steam account partition changes.
    const fixture = fs.mkdtempSync(path.join(profile, 'original-game-'));
    const index = path.join(fixture, 'index.html');
    fs.writeFileSync(index, '<!doctype html><title>Local import sample</title>');
    fs.copyFileSync(path.join(__dirname, '../public/steam-record-import.html'), path.join(fixture, 'steam-record-import.html'));
    const original = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
        await original.loadFile(index);
        await original.webContents.executeJavaScript("localStorage.setItem('serenityBlocks_odysseyProgress','guest-sample')");
        const { readLegacyRecords } = await import(pathToFileURL(path.join(__dirname, '../electron/legacy-record-import.js')).href);
        const imported = await readLegacyRecords(BrowserWindow, pathToFileURL(index).href);
        if (imported.odyssey !== 'guest-sample') throw new Error('Packaged file-origin guest import failed');
        console.log('Records renderer passed: guest import from original file origin');
    } finally { original.destroy(); }
    for (const phase of ['online', 'offline', 'other-account']) {
        const partition = phase === 'other-account' ? 'persist:qa-b' : 'persist:qa-a';
        const win = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true } });
        try {
            await win.loadURL('http://127.0.0.1:' + server.address().port);
            await win.webContents.executeJavaScript('(' + exercise.toString() + ')(' + JSON.stringify(phase) + ')');
            console.log('Records renderer passed:', phase);
        } finally { win.destroy(); }
    }
})().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); })
    .finally(() => server.close());
