// Exercise the built game, its normal local match configuration, the Phaser
// boards and the shared fixed-tick driver inside the shipped Electron runtime.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'serenity-bot-match-')));
const [out, countArg, secondsArg, hzArg] = process.argv.slice(2);
const count = Number(countArg), seconds = Number(secondsArg), hz = Number(hzArg);
async function sample() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (predicate, label) => {
        const start = performance.now();
        while (!predicate()) {
            if (performance.now() - start > 90000) throw Error('Timed out waiting for ' + label);
            await sleep(100);
        }
    };
    await until(() => window.serenityBlocks?.gameModeManager, 'game bootstrap');
    const game = window.serenityBlocks;
    const manager = game.gameModeManager;
    await manager.activateMode('local-multiplayer');
    const mode = manager.getCurrentMode();
    mode.deps.frameRateController.setTargetFPS(targetHz);
    const players = Math.max(2, botCount);
    const config = { numPlayers: players, attackStyle: 'standard', endCondition: 'frags', endConditionValue: 99,
        levelProgression: false, teamMode: false, playerHandicaps: [0, 0, 0, 0],
        playerSlots: Array.from({ length: players }, (_, i) => ({ slot: i, kind: i < botCount ? 'bot' : 'human',
            difficulty: 10, handicap: 0, name: 'Seat ' + (i + 1) })) };
    const init = mode._initializeSharedPieceRng.bind(mode);
    let round = 0;
    mode._initializeSharedPieceRng = () => init(83101 + round++);
    const times = [], intervals = [];
    let bucket = 0, actions = 0, frames = 0, prior = 0;
    const setup = mode._setupLocalBots.bind(mode);
    mode._setupLocalBots = () => {
        setup();
        for (const bot of mode.botManager.controllers.values()) {
            const update = bot.stepSlicedPlan.bind(bot);
            bot.stepSlicedPlan = (...args) => {
                const start = performance.now(); try { return update(...args); }
                finally { bucket += performance.now() - start; }
            };
            const adopt = bot.adoptPlan.bind(bot);
            bot.adoptPlan = p => { actions++; return adopt(p); };
        }
    };
    await mode.handleConfigurationComplete(config);
    await until(() => mode.isRunning && mode.botManager?.controllers.size === botCount, 'active bot seats');
    const start = performance.now();
    await new Promise(resolveSample => {
        function frame(now) {
            if (prior) intervals.push(now - prior);
            if (bucket > 0) times.push(bucket);
            bucket = 0; prior = now; frames++;
            if (now - start < duration * 1000) requestAnimationFrame(frame); else resolveSample();
        }
        requestAnimationFrame(frame);
    });
    return { frames, actions, times, intervals, elapsed: performance.now() - start, rounds: round,
        clock: mode._localSimulationLoop?.simulationClock, boards: mode.multiplayerState?.numPlayers,
        canvases: document.querySelectorAll('canvas').length, requestedHz: targetHz };
}
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { backgroundThrottling: false } });
    win.webContents.on('console-message', (_event, details) => {
        if (typeof details === 'object' && details.level === 'error') console.error(details.message);
    });
    const url = pathToFileURL(resolve('dist/index.html'));
    url.searchParams.set('fixedTick', '1');
    url.searchParams.set('skipIntro', '1');
    await win.loadURL(url.href);
    const code = 'const botCount=' + count + ', duration=' + seconds + ', targetHz=' + hz + ';(' + sample.toString() + ')()';
    const data = await win.webContents.executeJavaScript(code);
    writeFileSync(out, JSON.stringify(data), { flag: 'wx' });
    win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
