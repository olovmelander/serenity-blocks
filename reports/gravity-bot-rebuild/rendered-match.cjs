// Exercise the built game, its normal local match configuration, the Phaser
// boards and the shared fixed-tick driver inside the shipped Electron runtime.
const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { cpus, tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'serenity-bot-match-')));
// Mirror the shipping Electron main process before selecting the graphics device.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-webgl');
if (process.env.SERENITY_ENABLE_GPU_RASTERIZATION === '1') app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const [out, countArg, secondsArg, hzArg, tapePath] = process.argv.slice(2);
const count = Number(countArg), seconds = Number(secondsArg), hz = Number(hzArg);
function boardCheck(state, pending) {
    const types = state.boardGrid.map(row => row.map(c => c?.type || '.').join('')).join('/');
    if (!labelledChecks) return [state.score, state.piecesPlaced, types];
    const labels = new Map();
    const bodies = state.boardGrid.map(row => row.map(cell => {
        if (!cell) return '.';
        if (!labels.has(cell.id)) labels.set(cell.id, String.fromCharCode(65 + labels.size));
        return labels.get(cell.id);
    }).join('')).join('/');
    return [state.score, state.piecesPlaced, types, bodies, pending];
}
function overBudgetFrame(frame, round, tick, cost, active, calls, peak, peakStart, bot) {
    return { frame, round, tick, planningMs: cost, activeMs: active, calls, longestCallMs: peak, callStartMs: peakStart,
        tier: bot?.config.tier, slot: bot?.playerIndex, locks: bot?.playerState.piecesPlaced,
        pendingRows: bot?.getPendingGarbage() };
}
async function sample() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (predicate, label) => {
        const start = performance.now();
        while (!predicate()) {
            if (performance.now() - start > 90000) throw Error('Timed out waiting for ' + label + ', ' +
                document.readyState + ', ' + document.title + ', ' + document.body.innerText.slice(0, 280));
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
            difficulty: localTiers?.[i] ?? 10, handicap: 0, name: 'Seat ' + (i + 1) })) };
    const init = mode._initializeSharedPieceRng.bind(mode);
    let round = 0;
    mode._initializeSharedPieceRng = seed => {
        round++;
        return init(round === 1 ? 83101 : seed);
    };
    const times = [], activeUpdates = [], lateness = [], recoveries = [], intervals = [], inputs = [], checks = [], stalls = [];
    const byTick = new Map();
    for (const item of replayTape || []) {
        const key = item.slice(0, 3).join('/');
        if (!byTick.has(key)) byTick.set(key, []);
        byTick.get(key).push(item[3]);
    }
    let bucket = 0, updateCost = 0, didPlan = false, actions = 0, frames = 0, prior = 0;
    const overBudget = [], nearTwoFrames = [];
    let calls = 0, peak = 0, peakStart = 0, slowest;
    let maxExecutionUpdate = 0, executionOverFrame = 0;
    const observedManagers = new WeakSet();
    const setup = mode._setupLocalBots.bind(mode);
    mode._setupLocalBots = () => {
        setup();
        const bots = mode.botManager;
        if (!observedManagers.has(bots)) {
            observedManagers.add(bots);
            const advance = bots.advanceFixedInput.bind(bots);
            bots.advanceFixedInput = (index, context) => {
                if (replayTape) {
                    for (const command of byTick.get([round, index, context.tick].join('/')) || []) context.emit(command);
                } else {
                    advance(index, { ...context, emit: command => {
                        inputs.push([round, index, context.tick, command]);
                        return context.emit(command);
                    } });
                }
                if (index === 0 && context.tick % 300 === 0) {
                    checks.push([round, context.tick, ...mode.multiplayerState.players.map((s, i) =>
                        boardCheck(s, mode.multiplayerState.getGarbageQueue(i).getTotalLines()))]);
                }
            };
        }
        for (const bot of mode.botManager.controllers.values()) {
            const stepPlan = bot.stepSlicedPlan.bind(bot);
            bot.stepSlicedPlan = (...args) => {
                didPlan = true;
                const start = performance.now(); try { return stepPlan(...args); }
                finally {
                    const ms = performance.now() - start;
                    bucket += ms; calls++;
                    if (ms > peak) { peak = ms; peakStart = start; slowest = bot; }
                }
            };
            const update = bot.update.bind(bot);
            let tickTime = 0, adoptedSpawn = null, replanAt = null;
            bot.update = (dt, time) => {
                tickTime = time;
                if (bot.scheduler.rejected || bot.queueAtPlan !== bot.getPendingGarbage()) replanAt = time;
                const start = performance.now(); try { return update(dt, time); }
                finally { updateCost += performance.now() - start; }
            };
            const adopt = bot.adoptPlan.bind(bot);
            bot.adoptPlan = p => {
                actions++;
                if (adoptedSpawn !== bot.currentSpawnToken) {
                    adoptedSpawn = bot.currentSpawnToken;
                    lateness.push(Math.max(0, tickTime - bot.readyAtMs));
                } else if (replanAt !== null) recoveries.push(tickTime - replanAt);
                replanAt = null;
                return adopt(p);
            };
        }
    };
    await mode.handleConfigurationComplete(config);
    await until(() => mode.isRunning && mode.botManager?.controllers.size === botCount, 'active bot seats');
    const start = performance.now();
    await new Promise(resolveSample => {
        function frame(now) {
            if (prior) intervals.push(now - prior);
            if (prior && now - prior > 2000 / targetHz + 0.25) {
                stalls.push([frames, round, mode.multiplayerState.players[0].simFrame, now - prior, bucket, updateCost]);
            } else if (prior && now - prior >= 2000 / targetHz - 0.25) {
                nearTwoFrames.push([frames, round, mode.multiplayerState.players[0].simFrame, now - prior, bucket, updateCost]);
            }
            if (didPlan) { times.push(bucket); activeUpdates.push(updateCost); }
            else {
                maxExecutionUpdate = Math.max(maxExecutionUpdate, updateCost);
                executionOverFrame += Number(updateCost > 1000 / targetHz);
            }
            if (bucket > 1000 / targetHz) overBudget.push(overBudgetFrame(
                frames, round, mode.multiplayerState.players[0].simFrame, bucket, updateCost, calls, peak, peakStart, slowest));
            calls = 0; peak = 0; slowest = null;
            bucket = 0; updateCost = 0; didPlan = false; prior = now; frames++;
            if (now - start < duration * 1000) requestAnimationFrame(frame); else resolveSample();
        }
        requestAnimationFrame(frame);
    });
    return { frames, actions, times, activeUpdates, lateness, recoveries, intervals, inputs, checks, stalls, replay: Boolean(replayTape),
        elapsed: performance.now() - start, rounds: round, maxExecutionUpdate, executionOverFrame, overBudget, nearTwoFrames,
        clock: mode._localSimulationLoop?.simulationClock, boards: mode.multiplayerState?.numPlayers,
        canvases: document.querySelectorAll('canvas').length, requestedHz: targetHz };
}

async function sampleOdyssey() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let tries = 0; !window.serenityBlocks?.gameModeManager && tries < 900; tries++) await sleep(100);
    const manager = window.serenityBlocks.gameModeManager;
    await manager.activateMode('odyssey');
    const mode = manager.getCurrentMode();
    mode.deps.frameRateController.setTargetFPS(targetHz);
    mode.currentLevelId = 60;
    mode.currentLevelConfig = structuredClone(mode.levelRegistry.resolveLevelPresentation(60));
    if (rivalConfig) Object.assign(mode.currentLevelConfig.mechanics.versus, rivalConfig);
    const create = mode._createGameStateForLevel.bind(mode);
    let attempts = 0, activeTicks = 0, roundsPlayed = 0, duel;
    mode._createGameStateForLevel = (level, generation) => create(level, generation, 83101 + attempts);
    if (!await mode.prepareLevelStart()) throw Error('Orb 60 preparation failed');
    const times = [], activeUpdates = [], lateness = [], recoveries = [], intervals = [], inputs = [], checks = [], stalls = [];
    const commands = new Map();
    for (const [r, t, command] of replayTape || []) {
        const key = r + '/' + t;
        if (!commands.has(key)) commands.set(key, []);
        commands.get(key).push(command);
    }
    let count = 0, round = 0, bucket = 0, full = 0, planned = false, actions = 0, tickTime = 0;
    const overBudget = [], nearTwoFrames = [];
    let calls = 0, peak = 0, peakStart = 0;
    let maxExecutionUpdate = 0, executionOverFrame = 0;
    function observeDuel(current) {
        duel = current;
        const bot = duel.bot, attemptOffset = attempts++ * 1000;
        const controls = bot.scheduler.actions;
        if (!replayTape) for (const name of Object.keys(controls)) {
            const action = controls[name];
            controls[name] = () => { inputs.push([round, count, name]); return action(); };
        }
        const step = bot.stepSlicedPlan.bind(bot), update = bot.update.bind(bot), adopt = bot.adoptPlan.bind(bot);
        bot.stepSlicedPlan = (...args) => {
            planned = true;
            const at = performance.now(); try { return step(...args); }
            finally {
                const ms = performance.now() - at;
                bucket += ms; calls++;
                if (ms > peak) { peak = ms; peakStart = at; }
            }
        };
        let adoptedSpawn = null, replanAt = null;
        bot.adoptPlan = p => {
            actions++;
            if (adoptedSpawn !== bot.currentSpawnToken) {
                adoptedSpawn = bot.currentSpawnToken;
                lateness.push(Math.max(0, tickTime - bot.readyAtMs));
            } else if (replanAt !== null) recoveries.push(tickTime - replanAt);
            replanAt = null;
            return adopt(p);
        };
        bot.update = (dt, time) => {
            const tapeRound = attemptOffset + duel.round;
            if (round !== tapeRound) { round = tapeRound; roundsPlayed++; count = 0; adoptedSpawn = null; }
            count++; activeTicks++; tickTime = time;
            if (bot.scheduler.rejected || bot.queueAtPlan !== bot.getPendingGarbage()) replanAt = time;
            if (replayTape) for (const name of commands.get(round + '/' + count) || []) controls[name]();
            else {
                const at = performance.now(); try { update(dt, time); } finally { full += performance.now() - at; }
            }
            if (count % 300 === 0) checks.push([round, count, ...duel.players.map((s, i) =>
                boardCheck(s, duel.multiplayer.getGarbageQueue(i).getTotalLines()))]);
        };
    }
    const begin = mode.beginLevelRun.bind(mode);
    mode.beginLevelRun = () => {
        if (mode._activeLevelSession.duel !== duel) observeDuel(mode._activeLevelSession.duel);
        return begin();
    };
    if (!mode.beginLevelRun()) throw Error('Orb 60 run failed to start');
    const start = performance.now();
    let prior = 0, frames = 0, retriedSheet = null;
    await new Promise(finish => {
        function frame(now) {
            if (repeatRivals && (duel.stopped || duel.multiplayer.isGameOver)) {
                const sheet = document.getElementById('odyssey-failure-modal');
                const retry = sheet?.querySelector('button.sb-btn--primary');
                if (retry && sheet !== retriedSheet) { retriedSheet = sheet; retry.click(); }
            }
            if (prior) intervals.push(now - prior);
            if (prior && now - prior > 2000 / targetHz + 0.25) {
                stalls.push([frames, round, count, now - prior, bucket, full]);
            } else if (prior && now - prior >= 2000 / targetHz - 0.25) {
                nearTwoFrames.push([frames, round, count, now - prior, bucket, full]);
            }
            if (planned) { times.push(bucket); activeUpdates.push(full); }
            else {
                maxExecutionUpdate = Math.max(maxExecutionUpdate, full);
                executionOverFrame += Number(full > 1000 / targetHz);
            }
            if (bucket > 1000 / targetHz) overBudget.push(overBudgetFrame(frames, round, count, bucket, full, calls, peak, peakStart, duel.bot));
            prior = now; frames++; bucket = 0; full = 0; planned = false; calls = 0; peak = 0;
            if (now - start < duration * 1000) requestAnimationFrame(frame); else finish();
        }
        requestAnimationFrame(frame);
    });
    return { frames, actions, times, activeUpdates, lateness, recoveries, intervals, inputs, checks, stalls, replay: Boolean(replayTape),
        elapsed: performance.now() - start, rounds: roundsPlayed, attempts, activeTicks, rivalTier: duel.difficulty,
        maxExecutionUpdate, executionOverFrame, overBudget, nearTwoFrames,
        clock: 'odyssey-rival-60', boards: duel.players.length, canvases: document.querySelectorAll('canvas').length, requestedHz: targetHz };
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1280, height: 720,
        webPreferences: { offscreen: { useSharedTexture: true }, backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    win.webContents.setFrameRate(hz);
    let textures = 0;
    win.webContents.on('paint', event => {
        if (event.texture) { textures++; event.texture.release(); }
    });
    win.webContents.startPainting();
    win.webContents.on('console-message', event => {
        if (event.level === 'error' || /fail|start|bootstrap/i.test(event.message)) console.log(event.message);
    });
    win.webContents.session.webRequest.onErrorOccurred(details => console.error(details.error, details.url.slice(0, 240)));
    const build = resolve(process.env.SERENITY_BOT_BUILD || 'dist');
    const url = pathToFileURL(join(build, 'index.html'));
    const recorded = tapePath ? JSON.parse(readFileSync(tapePath, 'utf8')) : null;
    const labelled = !recorded || recorded.checkFormat === 'body-v1';
    // Old recordings used the explicit fixed clock. Current recordings go through
    // the default mode startup and also compare canonical bodies and queued rows.
    if (!labelled) url.searchParams.set('fixedTick', '1');
    url.searchParams.set('skipIntro', '1');
    await win.loadURL(url.href);
    const repeatRivals = countArg === 'odyssey' && (!recorded || recorded.attempts !== undefined);
    let focusEmulated = false;
    if (repeatRivals && !await win.webContents.executeJavaScript('document.hasFocus() && !document.hidden')) {
        // The retry countdown requires a foreground player. Give the offscreen
        // Chromium page focus without activating a desktop window.
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        focusEmulated = true;
    }
    const tape = recorded?.inputs || null;
    const rival = process.env.SERENITY_BOT_RIVAL_CONFIG ? JSON.parse(readFileSync(process.env.SERENITY_BOT_RIVAL_CONFIG, 'utf8')) : null;
    const localTiers = recorded?.localTiers || (process.env.SERENITY_BOT_TIERS
        ? process.env.SERENITY_BOT_TIERS.split(',').map(Number) : null);
    if (localTiers && (localTiers.length !== count || localTiers.some(t => !Number.isInteger(t) || t < 1 || t > 10))) {
        throw Error('Expected one local tier from 1 through 10 per bot');
    }
    const scenario = countArg === 'odyssey' ? sampleOdyssey : sample;
    const code = 'const botCount=' + count + ', duration=' + seconds + ', targetHz=' + hz
        + ', labelledChecks=' + labelled + ', replayTape=' + JSON.stringify(tape)
        + ', rivalConfig=' + JSON.stringify(rival) + ', localTiers=' + JSON.stringify(localTiers) + ', repeatRivals=' + repeatRivals
        + ';' + boardCheck.toString() + ';' + overBudgetFrame.toString() + ';(' + scenario.toString() + ')()';
    // The CPU sampler changes timing. Use it in a separate diagnostic pass.
    const profilePath = process.env.SERENITY_BOT_CPU_PROFILE;
    let navigationStart;
    if (profilePath) {
        if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
        const send = (name, args) => win.webContents.debugger.sendCommand(name, args);
        await send('Performance.enable');
        const metrics = await send('Performance.getMetrics');
        navigationStart = metrics.metrics.find(metric => metric.name === 'NavigationStart').value;
        await send('Profiler.enable');
        await send('Profiler.setSamplingInterval', { interval: 400 });
        await send('Profiler.start');
    }
    const data = await win.webContents.executeJavaScript(code);
    if (profilePath) {
        const { profile } = await win.webContents.debugger.sendCommand('Profiler.stop');
        writeFileSync(profilePath, JSON.stringify({ navigationStart, profile }), { flag: 'wx' });
    }
    data.checkFormat = labelled ? 'body-v1' : 'type-v1';
    if (localTiers) data.localTiers = localTiers;
    data.sharedTexturePaints = textures;
    data.outputMuted = win.webContents.isAudioMuted();
    const graphics = await app.getGPUInfo('complete');
    data.gpu = graphics.gpuDevice;
    data.runtime = { electron: process.versions.electron, chromium: process.versions.chrome,
        cpu: cpus()[0].model, renderer: graphics.auxAttributes?.glRenderer };
    if (repeatRivals) data.runtime.focusEmulated = focusEmulated;
    data.buildManifestSha256 = createHash('sha256').update(readFileSync(join(build, 'manifest.json'))).digest('hex');
    writeFileSync(out, JSON.stringify(data), { flag: 'wx' });
    win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
