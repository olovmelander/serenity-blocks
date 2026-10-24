/**
 * Capture the trailer's shots from the real game, frame by frame.
 *
 * Boots the built game in Chromium, sets each shot up (mode, theme, the game's own CPU bot on the
 * board), then freezes time with the virtual clock (virtual-clock.js) and records: every frame is
 * one step of exactly 1/fps of game time followed by a screenshot piped into ffmpeg, so the clip
 * plays smoothly at full speed however slowly the frames were drawn. On a machine without a GPU
 * the page renders through SwiftShader (WebGPU on the CPU): slow, but the same pixels.
 *
 * Usage (the capture build must be served: `npm run trailer:build -- --serve`, see build.mjs):
 *   node scripts/trailer/capture.mjs                       every shot in trailer-config.mjs
 *   node scripts/trailer/capture.mjs --only=stack-a,m3     just these
 *   node scripts/trailer/capture.mjs --missing             only shots without a clip yet
 *
 *   --base-url=URL     the game (default http://127.0.0.1:4174, build.mjs --serve)
 *   --out=DIR          output root (default artifacts/trailer; clips go to DIR/shots)
 *   --gpu              use the machine's GPU instead of SwiftShader (headed window)
 *   --quality=Extreme  effect quality tier (Minimal … Extreme; default High)
 *   --render-scale=0.75  the themes' 3D resolution against the page (default 1); the board and
 *                      HUD stay sharp at full size, and software rendering gets much faster
 *   --per-session=N    shots per browser before a fresh boot (default 5)
 *   --preroll=SEC      virtual seconds stepped before recording starts (default 0.3)
 */
/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop, no-console */
import { execSync, spawn } from 'node:child_process';
import {
    existsSync, mkdirSync, statSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { TRAILER } from './trailer-config.mjs';
import { planEdit } from './assemble.mjs';
import { installVirtualClock } from './virtual-clock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...value] = a.slice(2).split('=');
    return [key, value.join('=') || true];
}));
const BASE = String(args['base-url'] || 'http://127.0.0.1:4174');
const OUT = path.resolve(ROOT, String(args.out || 'artifacts/trailer'));
const SHOT_DIR = path.join(OUT, 'shots');
const QUALITY = String(args.quality || 'High');
const RENDER_SCALE = Number(args['render-scale'] || 1);
const PER_SESSION = Number(args['per-session'] || 5);
const PREROLL = Number(args.preroll ?? 0.3);
// Testing aid: record at most this many seconds of each shot.
const MAX_SECONDS = args.seconds ? Number(args.seconds) : Infinity;
const { fps, width, height } = TRAILER;
const STEP_MS = 1000 / fps;

// The online peers are tabs beside the host: none of them may be throttled as a background tab
// (frames stopped, timers slowed), as scripts/mp-soak.mjs also launches.
const UNTHROTTLED = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows'];
const LAUNCH = [...UNTHROTTLED, ...(args.gpu
    ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'])];

// Capture flags: no intro or warning, every theme open, no warm-up, no frame cap, and every
// adaptive-quality loop held still (see src/ui/url-parameters/*). odysseyDebug exposes the
// Odyssey test hooks in a built game.
const QUERY = [
    'skipIntro=1', 'photosensitivityWarning=0', 'unlockAll=1', 'noThemeWarm=1', 'noThemeFpsCap=1',
    'portalGateWorker=0', 'odysseyDebug=1', 'odysseyOverlay=0', 'odysseyDisableAdaptiveQuality=1',
    'odysseyAdaptiveGpuTiming=0', 'blackHoleNoDrs=1', 'blackHoleNoGpuDrs=1', 'noDRS=1', 'noAdaptivePacing=1',
].join('&');

const SETTINGS = {
    effectQuality: QUALITY,
    renderScale: RENDER_SCALE,
    targetFrameRate: 60,
    vsyncEnabled: true,
    enableAntialiasing: true,
    enableBloom: true,
    enableShadows: true,
    particleQuality: 'ultra',
    textureQuality: 'ultra',
    showFPSCounter: false,
    backgroundTabBehavior: 'continue',
    pauseOnFocusLoss: false,
    reducedMotion: false,
    reduceFlashing: false,
    customCursorEnabled: false,
    backgroundMode: 'Specific',
    backgroundTheme: 'forest',
    autoThemeChange: false,
    serenityDrift: 'off',
    breathingGuideAutoStart: false,
    odysseyAutoContinue: false,
    musicVolume: 0,
    sfxVolume: 0,
};

// Chrome that has no place in footage: debug readouts, menu buttons, hints, toasts, cursor.
const HIDE_CSS = `
#fps-counter, #performance-overlay, #odyssey-aaa-debug-overlay, #desktop-gpu-remediation-panel,
#serenity-hub-icon, #settings-btn-global, .hale-sessions-entry, #gamepad-hints-overlay,
#serenity-first-hints, #serenity-notification, #serenity-world-bar, .lv-coach,
#odyssey-navigator-btn, #demo-indicator, #playback-controls, #sb-toast-region,
.custom-cursor-container, .headphone-badge, .global-corner-controls,
.breath-guide__controls, #odyssey-level-panel, #odyssey-map-header, #odyssey-header-charms,
#odyssey-chapter-arrival-card { display: none !important; }
* { cursor: none !important; }`;

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
        return createRequire(path.join(root, '/'))('playwright');
    }
}

async function bundleAutoplay() {
    const result = await build({
        entryPoints: [path.join(ROOT, 'scripts', 'trailer', 'autoplay-entry.js')],
        bundle: true,
        format: 'iife',
        write: false,
        target: 'es2022',
        logLevel: 'silent',
        define: { 'import.meta.env.DEV': 'false' },
    });
    return result.outputFiles[0].text;
}

/** How many frames each shot needs: the longest stretch the cut list takes from it. */
export function shotLengths(trailer) {
    const lengths = {};
    planEdit(trailer.edit, trailer.duration).forEach((entry) => {
        const need = (entry.in || 0) + entry.clipLength;
        lengths[entry.shot] = Math.max(lengths[entry.shot] || 0, need);
    });
    return lengths;
}

const log = (...parts) => console.log(`[trailer ${new Date().toISOString().slice(11, 19)}]`, ...parts);

/**
 * SwiftShader's WebGPU rejects texture views with a `swizzle` (the breathing worlds ask for one);
 * drop it, as scripts/capture-hale-sessions.mjs does. A GPU never reaches this.
 */
function swiftShaderViewPolyfill() {
    // eslint-disable-next-line no-undef
    if (typeof GPUTexture === 'undefined') return;
    // eslint-disable-next-line no-undef
    const original = GPUTexture.prototype.createView;
    // eslint-disable-next-line no-undef
    GPUTexture.prototype.createView = function createView(descriptor) {
        if (descriptor && typeof descriptor.swizzle === 'string') {
            const { swizzle, ...rest } = descriptor;
            return original.call(this, rest);
        }
        return original.call(this, descriptor);
    };
}

// ---------------------------------------------------------------------------------------------
// In-page steps. Each runs inside the game page (page.evaluate) and must be self-contained.
// ---------------------------------------------------------------------------------------------

async function pagePrepare() {
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    const ready = () => window.serenityBlocks?.isInitialized
        && window.serenityBlocks.gameModeManager && window.serenityBlocks.themeManager;
    for (let i = 0; i < 3000 && !ready(); i += 1) await sleep(200);
    if (!ready()) throw new Error('the game did not finish booting');
    const app = window.serenityBlocks;
    if (app.soundManager && !app.soundManager.isMuted) {
        if (typeof app.soundManager.toggleMute === 'function') app.soundManager.toggleMute();
        app.soundManager.isMuted = true;
    }
    const tm = app.themeManager;
    tm.clearAdjacentThemePreloadQueue?.();
    tm.deferAdjacentThemePreload = true;
    tm.queueAdjacentThemePreload = () => {};
    tm.stopRandomThemeInterval?.();
    tm.startRandomThemeInterval = () => {};
    // A theme's start is timed in real milliseconds (10 s, 20 s for heavy ones), sized for a GPU;
    // on SwiftShader a heavy start can outlast it and the switch fails over to a retry.
    tm.getThemeLifecycleTimeout = () => 120000;
    // Each theme brings up its own WebGPU device, timed in real milliseconds (5.5–10 s). On
    // SwiftShader a new device queued behind the outgoing theme's busy one can take longer; the
    // theme then falls back to WebGL2, which draws nothing here (a blank world).
    // The patch goes on the themes' shared base class, reached through any live theme instance
    // (there may be none yet at boot): pageSwitchTheme and pageFlipWorld apply it before switching.
    window.__trailerPatchThemeInit = () => {
        const instance = tm.activeTheme || tm.pendingThemeInstance || tm.themeInstances?.values?.().next?.().value;
        let base = instance ? Object.getPrototypeOf(instance) : null;
        while (base && !Object.prototype.hasOwnProperty.call(base, 'initializeRendererCandidate')) {
            base = Object.getPrototypeOf(base);
        }
        if (!base) return false;
        if (!base.__trailerInitTimeout) {
            const initialize = base.initializeRendererCandidate;
            base.initializeRendererCandidate = function initializeRendererCandidate(renderer, options = {}) {
                return initialize.call(this, renderer, { ...options, timeoutMs: Math.max(options.timeoutMs ?? 0, 120000) });
            };
            base.__trailerInitTimeout = true;
        }
        return true;
    };
    const patchPoll = setInterval(() => { if (window.__trailerPatchThemeInit()) clearInterval(patchPoll); }, 50);
    window.performanceMonitor?.disable?.();
    return { theme: tm.activeThemeName, rendererInitPatched: window.__trailerPatchThemeInit() };
}

async function pageWaitThemeIdle({ themeId, timeoutMs = 600000 }) {
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    const tm = window.serenityBlocks.themeManager;
    const started = window.__trailerClock.realNow();
    const settled = () => !tm.isTransitioning && !tm.switchDrainPromise && !tm.queuedSwitchRequest
        && tm.activeTheme?.lifecycleState === 'running' && (!themeId || tm.activeThemeName === themeId);
    while (!settled()) {
        if (window.__trailerClock.realNow() - started > timeoutMs) return { ok: false, active: tm.activeThemeName };
        await sleep(250);
    }
    try { await tm.activeTheme?.whenCriticalReady?.(); } catch { /* best effort */ }
    return { ok: true, active: tm.activeThemeName };
}

async function pageSwitchTheme({ themeId }) {
    const app = window.serenityBlocks;
    const tm = app.themeManager;
    if (tm.activeThemeName === themeId && tm.activeTheme?.lifecycleState === 'running') return { switched: false };
    const patched = window.__trailerPatchThemeInit?.();
    if (!patched) console.warn('[trailer] renderer init timeout not patched before switching to', themeId);
    app.settingsManager?.update?.({ backgroundMode: 'Specific', backgroundTheme: themeId });
    await tm.switchTheme(themeId, true);
    return { switched: true };
}

async function pageStartMode({ mode }) {
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    const gm = window.serenityBlocks.gameModeManager;
    if (gm.getCurrentModeId?.() === mode && gm.getCurrentMode?.()?.isRunning) return { already: true };
    window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode } }));
    for (let i = 0; i < 3000; i += 1) {
        if (gm.getCurrentModeId?.() === mode && gm.getCurrentMode?.()?.isRunning) break;
        await sleep(200);
    }
    for (let i = 0; i < 300 && document.getElementById('cinematic-loading-overlay'); i += 1) await sleep(200);
    return { running: Boolean(gm.getCurrentMode?.()?.isRunning), mode: gm.getCurrentModeId?.() };
}

async function pageReturnToMenu() {
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    window.__trailerAutoplay?.stop();
    const app = window.serenityBlocks;
    try { app.serenityHub?.cancelGuidedSession?.(); } catch { /* not in a session */ }
    try { app.modalManager?.hideAll?.(); } catch { /* nothing open */ }
    if (app.gameModeManager.getCurrentModeId?.()) await app._returnToMainMenu?.();
    await sleep(1500);
    return { mode: app.gameModeManager.getCurrentModeId?.() ?? null };
}

async function pageRestartRun() {
    // A fresh run of the current mode (Single/Infinity): an empty well and level 1 again.
    const app = window.serenityBlocks;
    window.__trailerAutoplay?.stop();
    try { app.modalManager?.hideAll?.(); } catch { /* nothing open */ }
    const gm = app.gameModeManager;
    const mode = gm.getCurrentMode?.();
    if (mode?.isRunning) await gm.stopCurrentMode?.();
    await gm.startCurrentMode?.({});
    await window.__trailerClock.realSleep(800);
    return { running: Boolean(gm.getCurrentMode?.()?.isRunning) };
}

async function pageStartVersus({ seats = 4 }) {
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    const gm = window.serenityBlocks.gameModeManager;
    window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'local-multiplayer' } }));
    let mode = null;
    for (let i = 0; i < 3000; i += 1) {
        mode = gm.getCurrentModeId?.() === 'local-multiplayer' ? gm.getCurrentMode() : null;
        if (mode?.configModal) break;
        await sleep(200);
    }
    if (!mode?.configModal) return { ok: false, reason: 'no config modal' };
    const skills = [9, 8, 9, 7].slice(0, seats);
    const setup = {
        numPlayers: String(seats), matchMode: 'ffa', attackStyle: 'standard', endCondition: 'never',
        endConditionValue: '7', startLevel: '3', levelProgression: 'on',
    };
    skills.forEach((skill, i) => Object.assign(setup, {
        [`player${i + 1}Kind`]: 'bot',
        [`player${i + 1}BotDifficulty`]: String(skill),
        [`player${i + 1}Handicap`]: '2',
        [`player${i + 1}Team`]: String(i),
    }));
    mode.configModal.restoreSetup(setup);
    mode.configModal.handleSubmit();
    for (let i = 0; i < 3000; i += 1) {
        if (mode.isRunning && mode.botManager && mode.multiplayerState && !mode.multiplayerState.isPaused) break;
        await sleep(200);
    }
    return { ok: Boolean(mode.isRunning) };
}

async function pageStartHale({ session = 'FIRST', stage = 1 }) {
    // As scripts/capture-hale-sessions.mjs does: start the session, hold its clock, load the
    // stage's world behind the guide and wait for it to be drawn. The stage itself starts with
    // the recording (pageRunHaleStage), so its title card and its first breath land on frame 0.
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    const app = window.serenityBlocks;
    await app.startDeferredDesktopServices?.('menu-hale');
    const hub = app.serenityHub || await app.initializeGlobalSerenityHub();
    hub.openHaleSessions();
    await sleep(1500);
    hub.sessionsTab.startSession(session);
    await sleep(1500);
    const manager = app.serenityHub.sessionManager;
    manager.phaseTimeouts.forEach((entry) => clearTimeout(entry.timer));
    manager.phaseTimeouts.clear();
    clearInterval(manager.progressUpdateTimer);
    manager.progressUpdateTimer = null;
    window.breathingIndicator?._hideChapter?.();
    const world = manager._worldFor(manager.activeSession.phases[stage]);
    window.breathingIndicator.setTechnique(world);
    let live = false;
    for (let i = 0; i < 1500 && !live; i += 1) {
        live = Boolean(document.querySelector('.breath-guide')?.classList.contains('is-live'));
        if (!live) await sleep(200);
    }
    await sleep(1500);
    return { ok: live, world };
}

async function pageRunHaleStage({ stage = 1 }) {
    const manager = window.serenityBlocks.serenityHub.sessionManager;
    manager.currentPhaseIndex = stage;
    manager._runPhase();
    return { phase: manager.activeSession.phases[stage]?.name ?? stage };
}

async function pageStartOdyssey({ level }) {
    const sleep = (ms) => window.__trailerClock.realSleep(ms);
    if (!window.odysseyMode?.boardController?.isActive) {
        window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'odyssey' } }));
        for (let i = 0; i < 6000 && !window.odysseyMode?.boardController?.isActive; i += 1) await sleep(200);
        await sleep(800);
        document.querySelector('[data-flow-action="map"]')?.click();
        await sleep(800);
    }
    const om = window.odysseyMode;
    if (!om) return { ok: false, reason: 'no odyssey mode' };
    window.__trailerAutoplay?.stop();
    if (om.levelRunStarted) {
        // Back to the map from the last orb, rather than rebuilding the journey from the menu.
        await om.returnToBoard();
        for (let i = 0; i < 3000 && (om.levelRunStarted || !om.boardController?.isActive); i += 1) await sleep(200);
        await sleep(1000);
    }
    if (!level) {
        const bc = om.boardController;
        for (let i = 0; i < 3000; i += 1) {
            if ((bc.environmentManager?.environments?.size ?? 8) >= 8 && !(bc.pendingChapterLoads?.size)) break;
            await sleep(200);
        }
        return { ok: true, map: true };
    }
    const all = om.levelRegistry.getAllLevels();
    const target = all[Math.min(all.length, Math.max(1, level)) - 1];
    window.testOdysseyLevel(target.id);
    for (let i = 0; i < 6000 && !(om.levelRunStarted && om.gameState); i += 1) await sleep(200);
    // The run can be flagged as started while the loading surface still covers the orb (its
    // world is still compiling): wait for the surface to give way.
    for (let i = 0; i < 6000 && document.getElementById('cinematic-loading-overlay'); i += 1) await sleep(200);
    await sleep(1500);
    return { ok: Boolean(om.levelRunStarted), id: target.id, name: target.name ?? null };
}

async function pageOdysseyFlyover({ seconds, from = 0, to = 2 }) {
    // Glide the journey camera from one chapter's start to another's over the shot's length.
    const bc = window.odysseyMode?.boardController;
    const cam = bc?.cameraController;
    if (!cam) return { ok: false };
    const positions = bc.presentationLayout?.chapterPositions || [];
    const at = (chapter) => positions[chapter] ?? chapter / 8;
    cam.setCurrentPosition?.(at(from));
    cam.updateFollowPosition?.(at(from));
    cam.panToPosition?.(at(to), seconds * 1000);
    return { ok: true, from: at(from), to: at(to) };
}

async function pageOdysseyPose({ chapter = 0 }) {
    // Park the journey camera at a chapter's start before the world-drawn check and the shot.
    const bc = window.odysseyMode?.boardController;
    const cam = bc?.cameraController;
    if (!cam) return { ok: false };
    const positions = bc.presentationLayout?.chapterPositions || [];
    const position = positions[chapter] ?? chapter / 8;
    cam.setCurrentPosition?.(position);
    cam.updateFollowPosition?.(position);
    await window.__trailerClock.realSleep(4000);
    return { ok: true, position };
}

async function pageFlipWorld({ themeId, settleMs }) {
    // Change the world under a running game: hold the game (no gravity, no bot), let real time
    // run while the new theme loads and the outgoing one fades, then hold time again. The game
    // stays held (pageHoldGame resumes it) until record() sees the new world on screen.
    const app = window.serenityBlocks;
    const tm = app.themeManager;
    const started = window.__trailerClock.realNow();
    const mode = app.gameModeManager.getCurrentMode?.();
    const gs = mode?.getGameState?.() ?? mode?.gameState ?? null;
    window.__trailerAutoplay?.pause();
    if (gs) gs.isPaused = true;
    window.__trailerClock.thaw();
    try {
        if (!window.__trailerPatchThemeInit?.()) console.warn('[trailer] renderer init timeout not patched before', themeId);
        app.settingsManager?.update?.({ backgroundMode: 'Specific', backgroundTheme: themeId });
        await tm.switchTheme(themeId, true);
        for (let i = 0; i < 2400; i += 1) {
            if (!tm.isTransitioning && !tm.switchDrainPromise && !tm.queuedSwitchRequest
                && tm.activeTheme?.lifecycleState === 'running' && tm.activeThemeName === themeId) break;
            await window.__trailerClock.realSleep(250);
        }
        try { await tm.activeTheme?.whenCriticalReady?.(); } catch { /* best effort */ }
        await window.__trailerClock.realSleep(settleMs);
    } finally {
        window.__trailerClock.freeze();
    }
    return { active: tm.activeThemeName, seconds: Math.round((window.__trailerClock.realNow() - started) / 1000) };
}

/**
 * Where a theme switch stands: an in-play switch builds the incoming theme hidden while the
 * outgoing one plays on, reveals it when its pipelines are quiet and fades the outgoing one out
 * under it (themes/theme-manager.js). Done means the new world is revealed.
 */
function pageSwitchState() {
    const tm = window.serenityBlocks.themeManager;
    const state = {
        active: tm.activeThemeName,
        behind: Boolean(tm._behindBuild),
        fading: tm._fadingThemes?.size || 0,
        covering: tm._loadingSurfaceCovering || 0,
    };
    // The outgoing world may still be fading out under the new one: that is drawn on top.
    state.done = !state.behind && state.covering <= 0 && tm.activeTheme?.lifecycleState === 'running';
    return state;
}

/** Hold the running game (no gravity, no clock) or let it go on from where it was. */
function pageHoldGame(hold) {
    const mode = window.serenityBlocks.gameModeManager.getCurrentMode?.();
    const gs = mode?.getGameState?.() ?? mode?.gameState ?? null;
    if (!gs) return false;
    if (!hold) gs.lastTime = performance.now();
    gs.isPaused = hold;
    if (!hold) window.__trailerAutoplay?.resume();
    return true;
}

async function pageHostOnline({ players }) {
    // The mock transport (src/dev/console-harness.js): real Online Versus netcode between
    // windows of one browser over BroadcastChannel, lobbies in localStorage.
    if (typeof window.localMpHost !== 'function') {
        return { ok: false, reason: 'no online test harness: capture from a VITE_DEV_HARNESS=1 build (build.mjs)' };
    }
    await window.localMpHost({ autoStart: false, maxPlayers: players });
    await window.__trailerClock.realSleep(1500);
    return { ok: true };
}

/**
 * Keep every seat in the session while the capture holds a window still. Each page measures
 * the others' silence on its own clock, and while one window is frozen (or drawing a themed
 * frame for seconds on SwiftShader) the rest would take it for gone and drop it, outside a
 * round after 15 s, mid-round after 5 s. A network that cannot tell reports 0 silence, and
 * nobody is taken for gone (core/network/host-migration.js, multiplayer/ffa/presence.js).
 */
async function pageHoldPresence() {
    for (let w = 0; w < 300; w += 1) {
        const net = window.__getFfa?.()?.network || window.__getMode?.()?.steamNetworking;
        if (net && typeof net.peerSilenceMs === 'function') {
            Object.getPrototypeOf(net).peerSilenceMs = () => 0;
            return true;
        }
        // eslint-disable-next-line no-await-in-loop
        await window.__trailerClock.realSleep(100);
    }
    return false;
}

async function pageOnlinePlayers() {
    return window.__getFfa?.()?.players?.size || 0;
}

async function pageOnlineStart({ host }) {
    const ffa = window.__getFfa?.();
    if (!ffa) return { ok: false };
    if (host) {
        const config = window.__getMode().ffaGameState.matchConfig;
        config.endCondition = 'frags';
        config.endConditionValue = 10; // no seat tops out ten times inside a shot
    }
    ffa.setReady?.(true);
    return { ok: true };
}

/**
 * The mock transport names every seat Dev_<n> (core/steam/steam-networking.js); on screen they
 * read as player names. Swap them in the page's text, and keep swapping as the HUD redraws.
 */
async function pageOnlineNames({ names }) {
    const ffa = window.__getFfa?.();
    if (!ffa) return {};
    const swaps = new Map();
    Array.from(ffa.players.values()).forEach((player, i) => {
        if (player?.name && names[i]) swaps.set(player.name, names[i]);
    });
    const fix = (node) => {
        if (node.nodeType !== Node.TEXT_NODE) return;
        let text = node.nodeValue;
        swaps.forEach((to, from) => { if (text.includes(from)) text = text.split(from).join(to); });
        if (text !== node.nodeValue) node.nodeValue = text;
    };
    const sweep = (root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) fix(node);
    };
    sweep(document.body);
    new MutationObserver((records) => records.forEach((record) => {
        if (record.type === 'characterData') fix(record.target);
        record.addedNodes.forEach((node) => (node.nodeType === Node.TEXT_NODE ? fix(node) : sweep(node)));
    })).observe(document.body, { subtree: true, childList: true, characterData: true });
    return Object.fromEntries(swaps);
}

async function pageOnlinePhase() {
    return window.__getFfa?.()?.gamePhase || null;
}

// ---------------------------------------------------------------------------------------------

class Session {
    constructor(playwright, autoplaySource) {
        this.playwright = playwright;
        this.autoplaySource = autoplaySource;
        this.browser = null;
        this.page = null;
        this.cdp = null;
        this.context = null;
        this.peers = [];
        this.shotsTaken = 0;
    }

    async open() {
        const { chromium } = this.playwright;
        this.browser = await chromium.launch({ headless: !args.gpu, args: LAUNCH });
        const context = await this.browser.newContext({
            viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'no-preference',
        });
        this.context = context;
        this.page = await context.newPage();
        const page = this.page;
        page.on('pageerror', (error) => log('pageerror:', String(error.message).slice(0, 200)));
        page.on('console', (message) => {
            const text = message.text();
            // A theme on the WebGL2 backend draws nothing under SwiftShader: say so.
            if (/Automatic fallback|WebGL2|Device Lost|device lost|not patched/.test(text)
                && !/GL Driver/.test(text)) {
                log('renderer fallback:', text.slice(0, 200));
                return;
            }
            if (message.type() !== 'error') return;
            if (/GL Driver|WebGPU Context|ReadPixels|favicon/.test(text)) return;
            log('console.error:', text.slice(0, 200));
        });
        // On the context, so the online peer windows get them too.
        await context.addInitScript(swiftShaderViewPolyfill);
        // Online peer windows (?trailerPeer=1) boot light: a cheap theme on the lowest tier, so
        // they start (a heavy theme's start times out under software rendering) and cost little.
        const peerSettings = {
            ...SETTINGS, backgroundTheme: 'tornado', effectQuality: 'Minimal', renderScale: 0.5,
        };
        await context.addInitScript(`(${installVirtualClock.toString()})();`
            + `try{localStorage.setItem('serenityBlocksSettings',location.search.includes('trailerPeer=1')`
            + `?${JSON.stringify(JSON.stringify(peerSettings))}:${JSON.stringify(JSON.stringify(SETTINGS))});`
            + "localStorage.setItem('serenity.photosensitivityWarning','0');"
            + "localStorage.setItem('serenity.noThemeFpsCap','1');"
            + "localStorage.setItem('serenity.serenityMode.hints','3');}catch(e){}");
        this.cdp = await context.newCDPSession(page);
        await this.cdp.send('Animation.enable');
        const started = Date.now();
        await page.goto(`${BASE}/?${QUERY}`, { waitUntil: 'load', timeout: 300000 });
        await page.addStyleTag({ content: HIDE_CSS });
        await page.addScriptTag({ content: this.autoplaySource });
        const prepared = await page.evaluate(pagePrepare);
        log(`booted in ${Math.round((Date.now() - started) / 1000)} s (theme ${prepared.theme}; renderer init patched: ${prepared.rendererInitPatched})`);
        this.mode = null;
    }

    async close() {
        await this.browser?.close().catch(() => {});
        this.browser = null;
    }

    run(fn, payload) {
        return this.page.evaluate(fn, payload);
    }

    /** Put the game in the state the shot asks for. */
    async setup(id, shot) {
        const kind = shot.kind;
        const modeFor = {
            single: 'single', infinity: 'infinity', stillfall: 'stillfall', serenity: 'serenity',
            versus: 'local-multiplayer', odyssey: 'odyssey', hale: null, online: 'online-multiplayer',
        }[kind];
        const sameMode = this.mode && this.mode === modeFor && kind !== 'hale' && kind !== 'versus';
        if (!sameMode && this.mode !== undefined) {
            await this.run(pageReturnToMenu);
        }
        if (shot.theme) {
            await this.run(pageSwitchTheme, { themeId: shot.theme });
        }
        switch (kind) {
        case 'single':
        case 'infinity':
        case 'stillfall':
            if (sameMode) await this.run(pageRestartRun);
            else log(id, 'mode', JSON.stringify(await this.run(pageStartMode, { mode: modeFor })));
            break;
        case 'serenity':
            log(id, 'mode', JSON.stringify(await this.run(pageStartMode, { mode: 'serenity' })));
            break;
        case 'versus':
            log(id, 'versus', JSON.stringify(await this.run(pageStartVersus, { seats: shot.seats || 4 })));
            break;
        case 'hale':
            log(id, 'hale', JSON.stringify(await this.run(pageStartHale, { session: shot.session || 'FIRST', stage: shot.stage ?? 1 })));
            break;
        case 'odyssey':
            log(id, 'odyssey', JSON.stringify(await this.run(pageStartOdyssey, { level: shot.level || 0 })));
            break;
        case 'online':
            await this.startOnline(id, shot.players || 4);
            break;
        default:
            throw new Error(`unknown shot kind ${kind}`);
        }
        this.mode = modeFor;
        if (shot.theme) {
            await this.run(pageSwitchTheme, { themeId: shot.theme });
            const idle = await this.run(pageWaitThemeIdle, { themeId: shot.theme });
            log(id, 'theme', JSON.stringify(idle));
        } else if (kind !== 'hale' && !(kind === 'odyssey' && !shot.level)) {
            // (A Hale session draws a breathing world and the Odyssey map its journey, not a
            // theme: their own setups waited for them, and this wait would sit out its timeout.)
            await this.run(pageWaitThemeIdle, {});
        }
        // Let late pipelines and streamed textures land before time freezes.
        await this.run((ms) => window.__trailerClock.realSleep(ms), shot.settle ?? 4000);
        if (kind === 'online') {
            // Every seat plays: the peers' own bots, then the host's.
            for (const peer of [...this.peers, this.page]) {
                await peer.evaluate((options) => window.__trailerAutoplay.start(options), {
                    difficulty: shot.difficulty ?? 8, seed: (shot.seed ?? 1337) + this.peers.indexOf(peer) + 1,
                });
            }
        }
        if (['single', 'infinity', 'stillfall', 'odyssey'].includes(kind) && (kind !== 'odyssey' || shot.level)) {
            if (shot.prefill !== 0 && kind !== 'stillfall') {
                const placed = await this.run((options) => window.__trailerAutoplay.prefill(options), {
                    pieces: shot.prefill ?? (kind === 'infinity' ? 70 : 18),
                    maxHeight: shot.prefillHeight ?? (kind === 'infinity' ? 26 : 9),
                    seed: shot.seed ?? 7,
                });
                log(id, `prefilled ${placed} pieces`);
            }
            if (kind === 'stillfall') {
                const prepared = await this.run((options) => window.__trailerAutoplay.prepareStillfall(options), {
                    puzzle: shot.puzzle, steps: shot.presolve ?? 0,
                });
                log(id, 'stillfall', JSON.stringify(prepared));
                // The solver starts with the recording (record()): its pause over the decisive
                // piece must fall in the shot, not in the warm-up.
            } else {
                await this.run((options) => window.__trailerAutoplay.start(options), {
                    difficulty: shot.difficulty ?? 8, seed: shot.seed ?? 1337,
                });
            }
        }
    }

    /**
     * Online Versus: this page hosts a mock lobby, `players - 1` small peer windows join it and
     * every seat readies. The peers run in lockstep with the host under the same virtual clock
     * (record() steps them every frame), on a light theme so they cost little to draw.
     */
    async startOnline(id, players) {
        const hosted = await this.run(pageHostOnline, { players });
        if (!hosted.ok) throw new Error(hosted.reason);
        log(id, `host presence held: ${await this.run(pageHoldPresence)}`);
        for (let i = 1; i < players; i += 1) {
            // The host draws nothing while frozen, leaving the CPU to the peer's boot.
            await this.run(() => window.__trailerClock.freeze());
            const peer = await this.context.newPage();
            await peer.setViewportSize({ width: 480, height: 270 });
            peer.on('pageerror', (error) => log(`peer ${i} pageerror:`, String(error.message).slice(0, 160)));
            peer.on('console', (message) => {
                const text = message.text();
                if (/LOCAL MP|lobb|Lobb|join|Join|trailer|failed|rror/.test(text) && !/GL Driver|WebGPU Context/.test(text)) {
                    log(`peer ${i}:`, text.slice(0, 200));
                }
            });
            await peer.goto(`${BASE}/?${QUERY}&trailerPeer=1`, { waitUntil: 'load', timeout: 300000 });
            await peer.addScriptTag({ content: this.autoplaySource });
            await peer.evaluate(pagePrepare);
            // Online Versus starts on the theme already running: make that the light one first
            // (the menu's Forest times out starting on a peer), while the host still holds still.
            await peer.evaluate(pageSwitchTheme, { themeId: 'tornado' });
            const peerTheme = await peer.evaluate(pageWaitThemeIdle, { themeId: 'tornado', timeoutMs: 180000 });
            log(id, `peer ${i} theme ${JSON.stringify(peerTheme)}`);
            await this.run(() => window.__trailerClock.thaw());
            this.peers.push(peer);
            // Join once the peer is fully up (the harness's own ?localMp=join fires at boot,
            // before the mode can start).
            let joined = null;
            for (let attempt = 1; attempt <= 3 && !joined; attempt += 1) {
                joined = await peer.evaluate(async () => {
                    for (let w = 0; w < 300 && typeof window.localMpJoin !== 'function'; w += 1) {
                        await window.__trailerClock.realSleep(200);
                    }
                    return window.localMpJoin()
                        .then((lobby) => (lobby ? String(lobby) : null))
                        .catch((error) => { console.error(`[trailer] join failed: ${error.message}`); return null; });
                });
                if (!joined) log(id, `peer ${i} join attempt ${attempt} failed`);
            }
            log(id, `peer ${i} presence held: ${await peer.evaluate(pageHoldPresence)}`);
            for (let k = 0; k < 120 && (await this.run(pageOnlinePlayers)) < i + 1; k += 1) {
                await this.run((ms) => window.__trailerClock.realSleep(ms), 1000);
            }
            log(id, `peer ${i}: ${joined ? `joined ${joined}` : 'did not join'}; lobby has ${await this.run(pageOnlinePlayers)}`);
        }
        for (const peer of this.peers) {
            await peer.evaluate(pageOnlineStart, { host: false });
        }
        await this.run(pageOnlineStart, { host: true });
        await this.run((ms) => window.__trailerClock.realSleep(ms), 1000);
        await this.run(() => window.__getMode().lobbyWaitingRoom?.startMatch?.());
        for (let k = 0; k < 240; k += 1) {
            const phases = await Promise.all([this.page, ...this.peers].map((p) => p.evaluate(pageOnlinePhase).catch(() => null)));
            if (phases.every((phase) => phase === 'playing')) break;
            await this.run((ms) => window.__trailerClock.realSleep(ms), 500);
        }
        log(id, `online phases: ${JSON.stringify(await Promise.all([this.page, ...this.peers].map((p) => p.evaluate(pageOnlinePhase).catch(() => null))))}`);
        log(id, `online names: ${JSON.stringify(await this.run(pageOnlineNames, {
            names: ['Juniper', 'Kestrel', 'Marlow', 'Sable', 'Wren', 'Orrin', 'Tamsin', 'Ash'],
        }))}`);
    }

    /**
     * Wait for the world to be on screen before recording. A theme can report itself ready while
     * its pipelines still compile in the GPU process (in real time, and slowly on SwiftShader):
     * its first frames would be blank and the world would pop in mid-shot. The left edge of the
     * frame is world in every mode (the board and HUD sit centre and right), so sample it every
     * few real seconds, one game frame apart, until it holds content and stops changing.
     */
    async warmUntilDrawn(id, stepAll, { report = false, ready = null } = {}) {
        const { page, cdp } = this;
        const clip = { x: 0, y: 0, width: Math.round(width * 0.22), height, scale: 0.5 };
        let previous = 0;
        let steady = 0;
        for (let i = 0; i < 80; i += 1) {
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip });
            const size = data.length * 0.75;
            steady = size > 4000 && previous > 0 && Math.abs(size - previous) / previous < 0.15 ? steady + 1 : 0;
            if (ready && steady > 0 && !(await ready())) steady = 0;
            if (steady >= 2) {
                if (i > 2 || report) log(`${id}: world drawn after ${i} checks`);
                return;
            }
            previous = size;
            await page.evaluate((ms) => window.__trailerClock.realSleep(ms), 2500);
            await stepAll();
        }
        log(`${id}: the world never settled on screen; recording anyway`);
    }

    /** Freeze time and record `frames` frames into `file`. */
    async record(id, shot, frames, file) {
        const { page, cdp } = this;
        const { peers } = this;
        if (peers.length) await page.bringToFront();
        const stepAll = async () => {
            await Promise.all(peers.map((peer) => peer.evaluate((ms) => window.__trailerClock.step(ms), STEP_MS)));
            await page.evaluate((ms) => window.__trailerClock.step(ms), STEP_MS);
        };
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
        for (const peer of peers) await peer.evaluate(() => window.__trailerClock.freeze());
        await page.evaluate(() => window.__trailerClock.freeze());
        if (shot.kind === 'hale') log(id, JSON.stringify(await page.evaluate(pageRunHaleStage, { stage: shot.stage ?? 1 })));
        const preroll = Math.round((shot.preroll ?? PREROLL) * fps);
        for (let i = 0; i < preroll; i += 1) {
            await stepAll();
        }
        if (shot.kind === 'odyssey' && !shot.level && shot.flyover) {
            await page.evaluate(() => window.__trailerClock.thaw());
            await page.evaluate(pageOdysseyPose, { chapter: shot.flyover.from ?? 0 });
            await page.evaluate(() => window.__trailerClock.freeze());
        }
        if (shot.warm !== false && shot.kind !== 'hale') await this.warmUntilDrawn(id, stepAll);
        if (shot.kind === 'stillfall') {
            await page.evaluate((options) => window.__trailerAutoplay.startStillfall(options), {
                thinkMs: shot.thinkMs ?? 650,
            });
        }
        if (shot.kind === 'odyssey' && !shot.level) {
            await page.evaluate(pageOdysseyFlyover, { seconds: frames / fps, ...(shot.flyover || {}) });
        }
        // A still of the first frame, to check a setup without opening the clip.
        mkdirSync(path.join(OUT, 'stills'), { recursive: true });
        // Through CDP like the frames: no timeout, and a world's first frame can take a minute.
        const still = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        writeFileSync(path.join(OUT, 'stills', `${id}.jpg`), Buffer.from(still.data, 'base64'));
        const ffmpeg = spawn('ffmpeg', [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', file,
        ], { stdio: ['pipe', 'inherit', 'inherit'] });
        const done = new Promise((resolve, reject) => {
            ffmpeg.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
        });
        // World flips (shot.worlds): the theme changes before these frames, the game held meanwhile.
        const flips = (shot.worlds || []).slice(1).map((world) => ({ frame: Math.round(world.at * fps), ...world }));
        let nextFlip = 0;
        const started = Date.now();
        let stepMs = 0;
        for (let i = 0; i < frames; i += 1) {
            while (nextFlip < flips.length && flips[nextFlip].frame <= i) {
                const flip = flips[nextFlip];
                await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
                const result = await page.evaluate(pageFlipWorld, { themeId: flip.theme, settleMs: shot.settle ?? 4000 });
                await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
                log(`${id}: frame ${i} → ${flip.theme} ${JSON.stringify(result)}`);
                // A theme can report itself running while its pipelines still compile in real
                // time: step it, the game held, until it is on screen (a flip to a blank world
                // reads as a dropped frame).
                await this.warmUntilDrawn(`${id} ${flip.theme}`, stepAll, {
                    report: true,
                    ready: async () => (await page.evaluate(pageSwitchState)).done,
                });
                log(`${id}: ${flip.theme} ${JSON.stringify(await page.evaluate(pageSwitchState))}`);
                await page.evaluate(pageHoldGame, false);
                nextFlip += 1;
            }
            const stepStart = Date.now();
            await stepAll();
            stepMs += Date.now() - stepStart;
            const { data } = await cdp.send('Page.captureScreenshot', {
                format: 'jpeg', quality: 94, optimizeForSpeed: true,
            });
            if (!ffmpeg.stdin.write(Buffer.from(data, 'base64'))) {
                await new Promise((resolve) => { ffmpeg.stdin.once('drain', resolve); });
            }
            if (i % 30 === 29) {
                const per = (Date.now() - started) / (i + 1);
                log(`${id}: ${i + 1}/${frames} frames, ${(per / 1000).toFixed(2)} s/frame`
                    + ` (${(stepMs / (i + 1) / 1000).toFixed(2)} s of it drawing)`);
            }
        }
        ffmpeg.stdin.end();
        await done;
        for (const peer of peers) await peer.evaluate(() => window.__trailerClock.thaw());
        await page.evaluate(() => window.__trailerClock.thaw());
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    }
}

async function main() {
    const lengths = shotLengths(TRAILER);
    let ids = Object.keys(TRAILER.shots).filter((id) => lengths[id]);
    if (args.only) {
        const only = String(args.only).split(',');
        ids = ids.filter((id) => only.includes(id));
    }
    if (args.missing) ids = ids.filter((id) => !existsSync(path.join(SHOT_DIR, `${id}.mp4`)));
    // Shots of one kind back to back: a mode is entered once and only the theme changes.
    // The plain board shots last: every other setup gets tried (and can be fixed) early on.
    const KIND_ORDER = ['serenity', 'hale', 'stillfall', 'infinity', 'versus', 'online', 'odyssey', 'single'];
    const rank = (id) => KIND_ORDER.indexOf(TRAILER.shots[id].kind) * 2 + (TRAILER.shots[id].worlds ? 0 : 1);
    ids.sort((a, b) => rank(a) - rank(b));
    mkdirSync(SHOT_DIR, { recursive: true });
    log(`${ids.length} shots: ${ids.join(', ')}`);

    const playwright = await loadPlaywright();
    const autoplaySource = await bundleAutoplay();
    let session = null;
    const failed = [];
    for (const id of ids) {
        const shot = TRAILER.shots[id];
        const frames = Math.ceil(Math.min(lengths[id], MAX_SECONDS) * fps) + 2;
        const file = path.join(SHOT_DIR, `${id}.mp4`);
        let ok = false;
        for (let attempt = 1; attempt <= 2 && !ok; attempt += 1) {
            try {
                // Online shots get a browser of their own: their peer windows and mock lobby end
                // with it.
                const fresh = shot.kind === 'online' || session?.peers.length;
                if (!session || session.shotsTaken >= PER_SESSION || fresh) {
                    await session?.close();
                    session = new Session(playwright, autoplaySource);
                    await session.open();
                }
                log(`${id}: setting up ${JSON.stringify(shot)} (${frames} frames)`);
                await session.setup(id, shot);
                await session.record(id, shot, frames, file);
                session.shotsTaken += 1;
                log(`${id}: done → ${path.relative(ROOT, file)} (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
                ok = true;
            } catch (error) {
                log(`${id}: attempt ${attempt} failed: ${error.stack || error}`);
                await session?.close();
                session = null;
            }
        }
        if (!ok) failed.push(id);
    }
    await session?.close();
    if (failed.length) {
        log(`failed: ${failed.join(', ')}`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
