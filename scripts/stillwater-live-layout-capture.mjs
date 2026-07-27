/**
 * One-shot Stillwater production local-multiplayer layout capture.
 *
 * This harness deliberately follows the same production path as a player:
 * GameModeManager activates Local Multiplayer, the real configuration form is
 * populated and submitted, and LocalMultiplayerMode creates every Phaser game.
 * No synthetic Stillwater layout override is used.
 *
 * Examples:
 *   node scripts/run-electron.mjs scripts/stillwater-live-layout-capture.mjs --players=2
 *   node scripts/run-electron.mjs scripts/stillwater-live-layout-capture.mjs --players=4 --skip-build=true
 *   node scripts/run-electron.mjs scripts/stillwater-live-layout-capture.mjs \
 *     --base-url=http://127.0.0.1:4173 --players=4
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';
import { spawn } from 'child_process';
import {
    mkdir,
    writeFile,
} from 'fs/promises';
import path from 'path';
import {
    collectStillwaterSourceBuildFingerprint,
} from './stillwater-artifact-provenance.mjs';

const { app, BrowserWindow } = electron;
const ROOT = process.cwd();
const ARGS = parseArgs(process.argv.slice(2));
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DEFAULT_DIST_DIRECTORY = path.join(ROOT, 'dist');
const DIST_DIRECTORY = path.resolve(
    ROOT,
    typeof ARGS['dist-dir'] === 'string' ? ARGS['dist-dir'] : 'dist',
);
const PLAYERS = Number(ARGS.players ?? 2);

if (![2, 4].includes(PLAYERS)) {
    throw new Error(`--players must be 2 or 4; received ${ARGS.players ?? '<missing>'}.`);
}

const PORT = parsePositiveInt(ARGS.port, 4173);
const EXTERNAL_BASE_URL = typeof ARGS['base-url'] === 'string'
    ? ARGS['base-url']
    : null;
const BASE_URL = EXTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = path.resolve(
    ROOT,
    typeof ARGS.out === 'string'
        ? ARGS.out
        : path.join(
            'artifacts',
            'themes',
            'stillwater',
            'wave8',
            `live-local-${PLAYERS}p-${TIMESTAMP}`,
        ),
);

const CONFIG = Object.freeze({
    players: PLAYERS,
    expectedLayout: PLAYERS === 2 ? 'duo' : 'quad',
    quality: normalizeQuality(ARGS.quality, 'High'),
    targetFps: parsePositiveInt(ARGS['target-fps'], 60),
    width: parsePositiveInt(ARGS.width, 1920),
    height: parsePositiveInt(ARGS.height, 1080),
    startupTimeoutMs: parsePositiveInt(ARGS['startup-timeout-ms'], 180000),
    matchTimeoutMs: parsePositiveInt(ARGS['match-timeout-ms'], 120000),
    settleMs: parseNonNegativeInt(ARGS['settle-ms'], 2000),
    skipBuild: parseBoolean(ARGS['skip-build'], false),
    headed: !parseBoolean(ARGS.headless, false),
    forceWebGL: parseBoolean(ARGS['force-webgl'], false),
    expectBackend: normalizeExpectedBackend(
        ARGS['expect-backend'],
        ARGS['force-webgl'],
    ),
});

const PAGE_PARAMS = Object.freeze({
    skipIntro: '1',
    noThemeWarm: '1',
    stillwaterValidation: '1',
    stillwaterPerf: '1',
    stillwaterQuality: CONFIG.quality,
    captureBust: TIMESTAMP,
    ...(CONFIG.forceWebGL ? { forceWebGL: '1' } : {}),
});

const FAILURE_PATTERNS = Object.freeze([
    { id: 'wgsl', regex: /\bWGSL\b.*(?:error|invalid)|error.*\bWGSL\b/i },
    { id: 'shader_module', regex: /invalid\s+ShaderModule|shader module.*invalid/i },
    { id: 'render_pipeline', regex: /invalid\s+RenderPipeline|render pipeline.*invalid/i },
    { id: 'compute_pipeline', regex: /invalid\s+ComputePipeline|compute pipeline.*invalid/i },
    { id: 'pipeline_validation', regex: /pipeline.*validation error|validation error.*pipeline/i },
    { id: 'command_buffer', regex: /invalid\s+CommandBuffer|command buffer.*invalid/i },
    { id: 'webgpu_uncaptured', regex: /WebGPU uncaptured error|uncaptured GPU error/i },
]);

let previewProcess = null;
let previewLog = '';
let buildLog = '';
let mainWindow = null;
let shuttingDown = false;

function parseArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [key, inlineValue] = token.slice(2).split('=', 2);
        const next = argv[index + 1];
        if (inlineValue !== undefined) {
            parsed[key] = inlineValue;
        } else if (next && !next.startsWith('--')) {
            parsed[key] = next;
            index += 1;
        } else {
            parsed[key] = true;
        }
    }
    return parsed;
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function normalizeQuality(value, fallback) {
    const names = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
    const requested = String(value || fallback).trim().toLowerCase();
    return names.find((name) => name.toLowerCase() === requested) || fallback;
}

function normalizeExpectedBackend(value, forceWebGL) {
    if (parseBoolean(forceWebGL, false)) return 'WebGL2';
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'webgpu') return 'WebGPU';
    if (normalized === 'webgl' || normalized === 'webgl2') return 'WebGL2';
    return null;
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function createTargetUrl() {
    const url = new URL('/', BASE_URL);
    Object.entries(PAGE_PARAMS).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
    return url.toString();
}

function npmInvocation(args) {
    if (process.platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`],
        };
    }
    return { command: 'npm', args };
}

function runNpm(commandArgs, timeoutMs) {
    const invocation = npmInvocation(commandArgs);
    return new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: ROOT,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const chunks = [];
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, timeoutMs);

        child.stdout.on('data', (chunk) => chunks.push(String(chunk)));
        child.stderr.on('data', (chunk) => chunks.push(String(chunk)));
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            const output = chunks.join('');
            if (code === 0 && !timedOut) {
                resolve(output);
                return;
            }
            reject(new Error(
                `npm ${commandArgs.join(' ')} failed`
                + ` (${signal || code || (timedOut ? 'timeout' : 'unknown')}).\n${output}`,
            ));
        });
    });
}

async function buildProductionBundle() {
    if (CONFIG.skipBuild || EXTERNAL_BASE_URL) return;
    if (DIST_DIRECTORY !== DEFAULT_DIST_DIRECTORY) {
        throw new Error('A custom --dist-dir requires --skip-build true.');
    }
    console.log('[StillwaterLiveLayout] Building production bundle...');
    try {
        buildLog = await runNpm(['run', 'build'], 600000);
    } finally {
        await writeFile(path.join(ARTIFACT_DIR, 'build.log'), buildLog, 'utf8');
    }
}

function startPreviewServer() {
    if (EXTERNAL_BASE_URL) return null;
    const invocation = npmInvocation([
        'run',
        'preview',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--strictPort',
        '--outDir',
        DIST_DIRECTORY,
    ]);
    const child = spawn(invocation.command, invocation.args, {
        cwd: ROOT,
        env: {
            ...process.env,
            FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    child.stdout.on('data', (chunk) => {
        previewLog += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
        previewLog += String(chunk);
    });
    child.once('error', (error) => {
        previewLog += `[spawn-error] ${error.stack || error.message}\n`;
    });
    return child;
}

async function stopPreviewServer() {
    const child = previewProcess;
    previewProcess = null;
    if (child?.exitCode === null && process.platform === 'win32' && child.pid) {
        await new Promise((resolve) => {
            const killer = spawn(
                'taskkill.exe',
                ['/PID', String(child.pid), '/T', '/F'],
                { stdio: 'ignore', windowsHide: true },
            );
            killer.once('error', resolve);
            killer.once('exit', resolve);
        });
    } else if (child?.exitCode === null) {
        child.kill('SIGTERM');
        await delay(750);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await writeFile(path.join(ARTIFACT_DIR, 'preview.log'), previewLog, 'utf8');
}

async function waitForServer(url, timeoutMs) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url, { method: 'GET' });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await delay(400);
    }
    throw new Error(
        `Timed out waiting for production preview at ${url}: ${lastError?.message || 'unknown error'}`,
    );
}

function createWindow() {
    return new BrowserWindow({
        width: CONFIG.width,
        height: CONFIG.height,
        useContentSize: true,
        show: CONFIG.headed,
        backgroundColor: '#000000',
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: `stillwater-live-layout-${PLAYERS}p-${TIMESTAMP}`,
        },
    });
}

function executePageFunction(win, fn, payload, timeoutMs, label) {
    const source = `(${fn.toString()})(${JSON.stringify(payload)})`;
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
    });
    return Promise.race([
        win.webContents.executeJavaScript(source, true),
        timeout,
    ]).finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
    });
}

async function collectElectronGpuDiagnostics() {
    let gpuInfo = null;
    let gpuInfoError = null;
    try {
        gpuInfo = await app.getGPUInfo('complete');
    } catch (error) {
        gpuInfoError = error?.message || String(error);
    }
    let featureStatus = null;
    let featureStatusError = null;
    try {
        featureStatus = app.getGPUFeatureStatus();
    } catch (error) {
        featureStatusError = error?.message || String(error);
    }
    const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];
    return {
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        gpuInfo,
        gpuInfoError,
        featureStatus,
        featureStatusError,
        devices,
        activeDevices: devices.filter((device) => device?.active === true),
    };
}

async function bootstrapStillwaterPage(profile) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            try {
                if (predicate()) return true;
            } catch {
                // Startup may replace managers or themes while polling.
            }
            await sleep(100);
        }
        return false;
    };
    const withTimeout = async (promise, timeoutMs, label) => {
        let timeoutId = null;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    };
    const resolveBackend = (theme) => {
        if (theme?.isWebGPU || theme?.renderer?.backend?.isWebGPUBackend) return 'WebGPU';
        if (theme?.isWebGL || theme?.renderer?.backend?.isWebGLBackend) return 'WebGL2';
        const backendName = String(
            theme?.backendName
            || theme?.renderer?.backend?.constructor?.name
            || '',
        );
        if (/webgpu/i.test(backendName)) return 'WebGPU';
        if (/webgl/i.test(backendName)) return 'WebGL2';
        return 'Unknown';
    };

    const appReady = await waitFor(
        () => Boolean(
            window.serenityBlocks?.isInitialized
            && window.serenityBlocks?.settingsManager
            && window.serenityBlocks?.gameModeManager
            && window.serenityBlocks?.themeManager,
        ),
        profile.startupTimeoutMs,
    );
    if (!appReady) {
        return {
            ok: false,
            reason: 'Application managers were not ready.',
            page: {
                readyState: document.readyState,
                visibilityState: document.visibilityState,
                hasSerenityBlocks: Boolean(window.serenityBlocks),
                startupPipeline: window.startupPipeline?.snapshot?.() || null,
                bodyClasses: [...document.body.classList],
            },
        };
    }

    const game = window.serenityBlocks;
    const pinnedSettings = {
        effectQuality: profile.quality,
        graphicsQuality: profile.quality,
        targetFrameRate: profile.targetFps,
        renderScale: 1,
        enableAntialiasing: false,
        backgroundComboEffects: true,
        backgroundTabBehavior: 'pause',
        backgroundMode: 'Specific',
        backgroundTheme: 'stillwater',
    };

    try {
        game.settingsManager.update?.(pinnedSettings, false);
        window.settings = game.settingsManager.get?.() || {
            ...(window.settings || {}),
            ...pinnedSettings,
        };
        await game.applyDisplaySettings?.(window.settings);
        game.applyEffectQuality?.(profile.quality);
        await game.applyFrameRateSettings?.(window.settings);
        game.frameRateController?.setTargetFPS?.(profile.targetFps);
        window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);
        window.perfMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    } catch (error) {
        return {
            ok: false,
            reason: `Failed to pin validation settings: ${error?.message || String(error)}`,
        };
    }

    try {
        const manager = game.gameModeManager;
        game.startPostMenuRenderer?.();
        if (manager.getCurrentModeId?.() !== 'single') {
            if (manager.getCurrentMode?.()?.isRunning) {
                await withTimeout(manager.stopCurrentMode(), 45000, 'stopCurrentMode()');
            }
            if (manager.getCurrentMode?.()) {
                await withTimeout(
                    manager.deactivateCurrentMode(),
                    45000,
                    'deactivateCurrentMode()',
                );
            }
            await withTimeout(manager.activateMode('single'), 45000, 'activateMode(single)');
        }
        game.movePhaserGameToContainer?.('phaser-game-container');
        const phaserCanvas = game.phaserGame?.canvas
            || document.querySelector('#phaser-game-container canvas');
        [
            'position',
            'top',
            'left',
            'width',
            'height',
            'z-index',
        ].forEach((property) => phaserCanvas?.style?.removeProperty?.(property));
        document.body.classList.remove('serenity-mode');
        game.handleResize?.();
        if (!manager.getCurrentMode?.()?.isRunning) {
            await withTimeout(
                manager.startCurrentMode({ seed: 0x53545752 }),
                45000,
                'startCurrentMode(single)',
            );
        }
        game.movePhaserGameToContainer?.('phaser-game-container');
        game.handleResize?.();
        game.modalManager?.hideAll?.();
        document.body.classList.remove('start-modal-open');
        await withTimeout(
            game.themeManager.switchTheme('stillwater', true),
            60000,
            'switchTheme(stillwater)',
        );
    } catch (error) {
        return {
            ok: false,
            reason: `Failed to activate production Stillwater: ${error?.message || String(error)}`,
        };
    }

    const themeReady = await waitFor(() => {
        const manager = window.themeManager || game.themeManager;
        const theme = manager?.activeTheme;
        return manager?.activeThemeName === 'stillwater'
            && Boolean(theme?.renderer)
            && typeof theme?.whenFullReady === 'function';
    }, profile.startupTimeoutMs);
    if (!themeReady) {
        return {
            ok: false,
            reason: 'Production Stillwater did not expose its renderer/readiness API.',
        };
    }

    const themeManager = window.themeManager || game.themeManager;
    const theme = themeManager.activeTheme;
    try {
        const fullReady = await withTimeout(
            theme.whenFullReady(),
            profile.startupTimeoutMs,
            'Stillwater whenFullReady()',
        );
        if (fullReady === false) {
            return { ok: false, reason: 'Stillwater whenFullReady() resolved false.' };
        }
    } catch (error) {
        return {
            ok: false,
            reason: `Stillwater full readiness failed: ${error?.message || String(error)}`,
        };
    }

    const debugReady = await waitFor(
        () => Boolean(window.__STILLWATER_MASTERPIECE__),
        profile.startupTimeoutMs,
    );
    if (!debugReady) {
        return {
            ok: false,
            reason: 'window.__STILLWATER_MASTERPIECE__ was not installed.',
        };
    }
    const debug = window.__STILLWATER_MASTERPIECE__;
    try {
        if (debug.ready) {
            const ready = await withTimeout(
                debug.ready,
                profile.startupTimeoutMs,
                'Stillwater debug ready',
            );
            if (ready === false) {
                return { ok: false, reason: 'Stillwater debug ready resolved false.' };
            }
        }
    } catch (error) {
        return {
            ok: false,
            reason: `Stillwater debug readiness failed: ${error?.message || String(error)}`,
        };
    }
    if (typeof debug.isReady === 'function' && !debug.isReady()) {
        return {
            ok: false,
            reason: 'Stillwater debug API reports target LOD is not ready.',
        };
    }

    const singleBoardReady = await waitFor(() => {
        const canvas = document.querySelector('#phaser-game-container canvas');
        const rect = canvas?.getBoundingClientRect?.();
        return game.gameModeManager.getCurrentModeId?.() === 'single'
            && game.gameModeManager.getCurrentMode?.()?.isRunning === true
            && game.phaserGame?.scene?.isActive?.('BoardScene') === true
            && rect?.width >= 200
            && rect?.height >= 400;
    }, 15000);
    if (!singleBoardReady) {
        return {
            ok: false,
            reason: 'Production single-player board was not visible and running before the mode switch.',
        };
    }

    window.isRenderingPaused = false;
    window.isRenderingReduced = false;
    window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    window.perfMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const backend = resolveBackend(theme);
    if (profile.expectBackend && backend !== profile.expectBackend) {
        return {
            ok: false,
            reason: `Expected ${profile.expectBackend}, initialized ${backend}.`,
            backend,
        };
    }

    return {
        ok: true,
        backend,
        quality: theme.getCurrentQualityLevel?.()
            || theme.activeQualityLevel
            || window.settings?.effectQuality
            || null,
        themeCanvasCount: document.querySelectorAll('#stillwater-theme canvas').length,
        initialModeId: game.gameModeManager.getCurrentModeId?.() || null,
        initialBoardSceneActive: game.phaserGame?.scene?.isActive?.('BoardScene') === true,
    };
}

async function startLiveLocalMultiplayerPage(options) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            try {
                if (predicate()) return true;
            } catch {
                // Mode setup replaces several collections while polling.
            }
            await sleep(100);
        }
        return false;
    };
    const withTimeout = async (promise, timeoutMs, label) => {
        let timeoutId = null;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    };
    const selectValue = (selector, value) => {
        const select = document.querySelector(selector);
        if (!select) throw new Error(`Missing production form control ${selector}.`);
        const setter = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            'value',
        )?.set;
        setter?.call(select, String(value));
        if (!setter) select.value = String(value);
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (select.value !== String(value)) {
            throw new Error(
                `Production form control ${selector} rejected value ${value}.`,
            );
        }
    };
    const getBoard = (mode, playerNumber) => {
        const index = playerNumber - 1;
        const container = document.getElementById(`p${playerNumber}-phaser-container`);
        const card = document.getElementById(`player-${playerNumber}-card`);
        const canvas = container?.querySelector('canvas')
            || mode?.phaserGames?.[index]?.canvas
            || null;
        const rect = canvas?.getBoundingClientRect?.() || null;
        const cardRect = card?.getBoundingClientRect?.() || null;
        const sceneKey = mode?.boardScenes?.[index]?.scene?.key || `P${playerNumber}Board`;
        const gameSceneManager = mode?.phaserGames?.[index]?.scene;
        const sceneActive = gameSceneManager?.isActive?.(sceneKey) === true
            || mode?.boardScenes?.[index]?.scene?.isActive?.() === true;
        const style = canvas ? getComputedStyle(canvas) : null;
        const cardStyle = card ? getComputedStyle(card) : null;
        return {
            playerNumber,
            sceneKey,
            sceneActive,
            containerConnected: container?.isConnected === true,
            cardConnected: card?.isConnected === true,
            cardVisible: Boolean(
                card
                && cardRect?.width > 0
                && cardRect?.height > 0
                && cardStyle?.display !== 'none'
                && cardStyle?.visibility !== 'hidden',
            ),
            canvasConnected: canvas?.isConnected === true,
            canvasMatchesGame: canvas === mode?.phaserGames?.[index]?.canvas,
            canvas: canvas ? {
                width: canvas.width,
                height: canvas.height,
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight,
                display: style?.display || null,
                visibility: style?.visibility || null,
                opacity: style?.opacity || null,
                rect: rect ? {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    right: rect.right,
                    bottom: rect.bottom,
                } : null,
            } : null,
            cardRect: cardRect ? {
                x: cardRect.x,
                y: cardRect.y,
                width: cardRect.width,
                height: cardRect.height,
                right: cardRect.right,
                bottom: cardRect.bottom,
            } : null,
        };
    };
    const boardIsReady = (mode, playerNumber) => {
        const board = getBoard(mode, playerNumber);
        return board.containerConnected
            && board.cardVisible
            && board.canvasConnected
            && board.canvasMatchesGame
            && board.sceneActive
            && board.canvas?.width > 0
            && board.canvas?.height > 0
            && board.canvas?.rect?.width >= 80
            && board.canvas?.rect?.height >= 160
            && board.canvas?.display !== 'none'
            && board.canvas?.visibility !== 'hidden'
            && Number(board.canvas?.opacity ?? 1) > 0;
    };

    const game = window.serenityBlocks;
    const manager = game?.gameModeManager;
    const themeManager = window.themeManager || game?.themeManager;
    if (!game || !manager || !themeManager?.activeTheme?.applyLayout) {
        return {
            ok: false,
            reason: 'Production managers or Stillwater applyLayout() are unavailable.',
        };
    }

    try {
        if (manager.getCurrentMode?.()?.isRunning) {
            await withTimeout(
                manager.stopCurrentMode(),
                45000,
                'stopCurrentMode(single)',
            );
        }
        if (manager.getCurrentMode?.()) {
            await withTimeout(
                manager.deactivateCurrentMode(),
                45000,
                'deactivateCurrentMode(single)',
            );
        }
        await withTimeout(
            manager.activateMode('local-multiplayer'),
            45000,
            'activateMode(local-multiplayer)',
        );
    } catch (error) {
        return {
            ok: false,
            reason: `Could not activate Local Multiplayer: ${error?.message || String(error)}`,
        };
    }

    const formReady = await waitFor(() => {
        const modal = document.getElementById('local-match-config-modal');
        const form = document.getElementById('local-match-config-form');
        return manager.getCurrentModeId?.() === 'local-multiplayer'
            && manager.getCurrentMode?.()?.isActive === true
            && modal?.classList.contains('show')
            && !modal?.classList.contains('hidden')
            && Boolean(form);
    }, 15000);
    if (!formReady) {
        return {
            ok: false,
            reason: 'The real Local Multiplayer configuration form did not become visible.',
        };
    }

    try {
        selectValue('#num-players', options.players);
        selectValue('#match-mode', 'ffa');
        selectValue('#attack-style', 'peaceful');
        selectValue('#end-condition', 'never');
        const form = document.getElementById('local-match-config-form');
        if (!form) throw new Error('Production local-match form disappeared.');
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
        } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
    } catch (error) {
        return {
            ok: false,
            reason: `Could not submit the real Local Multiplayer form: ${error?.message || String(error)}`,
        };
    }

    const matchReady = await waitFor(() => {
        const mode = manager.getCurrentMode?.();
        const gameArea = document.querySelector('.multiplayer-game-area');
        const container = document.getElementById('multiplayer-container');
        const containerStyle = container ? getComputedStyle(container) : null;
        return manager.getCurrentModeId?.() === 'local-multiplayer'
            && mode?.isActive === true
            && mode?.isRunning === true
            && Number(mode?.matchConfig?.numPlayers) === options.players
            && Number(mode?.multiplayerState?.numPlayers) === options.players
            && mode?.multiplayerState?.isPaused === false
            && mode?.phaserGames?.length === options.players
            && mode?.boardScenes?.length === options.players
            && document.body.classList.contains('phaser-multiplayer-active')
            && gameArea?.classList.contains(`players-${options.players}`)
            && containerStyle?.display !== 'none'
            && containerStyle?.visibility !== 'hidden'
            && Number(containerStyle?.opacity ?? 0) >= 0.99
            && !document.getElementById('cinematic-loading-overlay')
            && Array.from(
                { length: options.players },
                (_, index) => boardIsReady(mode, index + 1),
            ).every(Boolean);
    }, options.matchTimeoutMs);

    const mode = manager.getCurrentMode?.();
    if (matchReady) {
        game.handleResize?.();
        manager.handleResize?.();
        await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        themeManager.activeTheme.applyLayout();
        await sleep(options.settleMs);
        themeManager.activeTheme.applyLayout();
        await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    const policy = themeManager.activeTheme.layoutPolicy
        || themeManager.activeTheme.applyLayout();
    const boards = Array.from(
        { length: options.players },
        (_, index) => getBoard(mode, index + 1),
    );
    const extraPlayerCards = Array.from(
        { length: 4 - options.players },
        (_, index) => {
            const playerNumber = options.players + index + 1;
            const card = document.getElementById(`player-${playerNumber}-card`);
            const rect = card?.getBoundingClientRect?.();
            const style = card ? getComputedStyle(card) : null;
            return {
                playerNumber,
                connected: card?.isConnected === true,
                hidden: !card
                    || style?.display === 'none'
                    || style?.visibility === 'hidden'
                    || rect?.width === 0
                    || rect?.height === 0,
            };
        },
    );
    const modal = document.getElementById('local-match-config-modal');
    const modalStyle = modal ? getComputedStyle(modal) : null;
    const modalHidden = !modal
        || modal.classList.contains('hidden')
        || modalStyle?.display === 'none'
        || modalStyle?.visibility === 'hidden';
    const overlay = document.getElementById('cinematic-loading-overlay');
    const themeCanvasCount = document.querySelectorAll('#stillwater-theme canvas').length;
    const gameArea = document.querySelector('.multiplayer-game-area');
    const multiplayerContainer = document.getElementById('multiplayer-container');
    const multiplayerContainerStyle = multiplayerContainer
        ? getComputedStyle(multiplayerContainer)
        : null;
    const expectedBoardCount = options.players;
    const policySafeRegionCount = policy?.boardSafeRegions?.length ?? 0;
    const boardGate = boards.every((board) => (
        board.containerConnected
        && board.cardVisible
        && board.canvasConnected
        && board.canvasMatchesGame
        && board.sceneActive
        && board.canvas?.width > 0
        && board.canvas?.height > 0
        && board.canvas?.rect?.width >= 80
        && board.canvas?.rect?.height >= 160
    ));
    const ok = matchReady
        && manager.getCurrentModeId?.() === 'local-multiplayer'
        && mode?.isActive === true
        && mode?.isRunning === true
        && Number(mode?.matchConfig?.numPlayers) === options.players
        && Number(mode?.multiplayerState?.numPlayers) === options.players
        && mode?.multiplayerState?.isPaused === false
        && mode?.phaserGames?.length === expectedBoardCount
        && mode?.boardScenes?.length === expectedBoardCount
        && boardGate
        && extraPlayerCards.every((entry) => entry.hidden)
        && document.body.classList.contains('phaser-multiplayer-active')
        && gameArea?.classList.contains(`players-${options.players}`)
        && modalHidden
        && !overlay
        && policy?.layout === options.expectedLayout
        && policySafeRegionCount === expectedBoardCount
        && themeCanvasCount === 1;

    return {
        ok,
        reason: ok
            ? null
            : 'The live Local Multiplayer layout did not satisfy every production readiness assertion.',
        productionPath: {
            activatedMode: 'local-multiplayer',
            submittedForm: '#local-match-config-form',
            selectedPlayers: options.players,
            matchMode: 'ffa',
            attackStyle: 'peaceful',
            endCondition: 'never',
            syntheticLayoutOverrideUsed: false,
        },
        matchReady,
        mode: {
            id: manager.getCurrentModeId?.() || null,
            isActive: mode?.isActive === true,
            isRunning: mode?.isRunning === true,
            configuredForStart: mode?.configuredForStart === true,
            matchConfigPlayers: mode?.matchConfig?.numPlayers ?? null,
            multiplayerStatePlayers: mode?.multiplayerState?.numPlayers ?? null,
            multiplayerStatePaused: mode?.multiplayerState?.isPaused ?? null,
            phaserGameCount: mode?.phaserGames?.length ?? null,
            boardSceneCount: mode?.boardScenes?.length ?? null,
        },
        dom: {
            bodyClasses: [...document.body.classList],
            gameAreaClasses: gameArea ? [...gameArea.classList] : [],
            multiplayerContainer: multiplayerContainer ? {
                display: multiplayerContainerStyle?.display || null,
                visibility: multiplayerContainerStyle?.visibility || null,
                opacity: multiplayerContainerStyle?.opacity || null,
            } : null,
            modalHidden,
            cinematicOverlayPresent: Boolean(overlay),
            themeCanvasCount,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
            },
        },
        policy: policy ? {
            layout: policy.layout,
            gameMode: policy.gameMode,
            playerCount: policy.playerCount,
            narrow: policy.narrow,
            aspect: policy.aspect,
            camera: policy.camera,
            boardSafeRegions: policy.boardSafeRegions,
        } : null,
        boards,
        extraPlayerCards,
        assertions: {
            exactLiveBoardCount: mode?.phaserGames?.length === expectedBoardCount
                && mode?.boardScenes?.length === expectedBoardCount,
            everyLiveBoardReady: boardGate,
            unusedPlayerCardsHidden: extraPlayerCards.every((entry) => entry.hidden),
            productionModeRunning: mode?.isActive === true && mode?.isRunning === true,
            simulationUnpaused: mode?.multiplayerState?.isPaused === false,
            multiplayerBodyClass: document.body.classList.contains('phaser-multiplayer-active'),
            playerCountLayoutClass: gameArea?.classList.contains(`players-${options.players}`),
            configurationModalHidden: modalHidden,
            cinematicOverlayAbsent: !overlay,
            inferredStillwaterLayout: policy?.layout === options.expectedLayout,
            safeRegionCountMatchesBoards: policySafeRegionCount === expectedBoardCount,
            oneStillwaterCanvas: themeCanvasCount === 1,
        },
    };
}

function serializeConsoleEntry(entry) {
    return {
        timestamp: new Date(entry.timestamp).toISOString(),
        level: entry.level,
        message: entry.message,
        line: entry.line,
        sourceId: entry.sourceId,
    };
}

function summarizeConsole(entries, processFailures) {
    const errors = entries.filter((entry) => entry.level >= 3);
    const warnings = entries.filter((entry) => entry.level === 2);
    const patternFailures = [];
    FAILURE_PATTERNS.forEach((rule) => {
        const matches = entries.filter((entry) => rule.regex.test(entry.message));
        if (matches.length) {
            patternFailures.push({
                id: rule.id,
                count: matches.length,
                samples: matches.slice(0, 5).map(serializeConsoleEntry),
            });
        }
    });
    return {
        entryCount: entries.length,
        warningCount: warnings.length,
        errorCount: errors.length,
        processFailureCount: processFailures.length,
        shaderPipelineFailureCount: patternFailures
            .reduce((sum, failure) => sum + failure.count, 0),
        shaderPipelineFailures: patternFailures,
        errorSamples: errors.slice(0, 20).map(serializeConsoleEntry),
        warningSamples: warnings.slice(0, 20).map(serializeConsoleEntry),
        processFailures,
        ok: errors.length === 0
            && processFailures.length === 0
            && patternFailures.length === 0,
    };
}

async function captureScreenshot(win) {
    const filename = `stillwater-live-local-${PLAYERS}p.png`;
    const image = await win.webContents.capturePage();
    const target = path.join(ARTIFACT_DIR, filename);
    await writeFile(target, image.toPNG());
    return path.relative(ROOT, target);
}

async function writeConsoleArtifacts(entries, summary) {
    const consoleText = entries.map((entry) => (
        `[${new Date(entry.timestamp).toISOString()}][L${entry.level}] `
        + `${entry.sourceId || '<unknown>'}:${entry.line || 0} ${entry.message}`
    )).join('\n');
    await Promise.all([
        writeFile(
            path.join(ARTIFACT_DIR, 'console.log'),
            consoleText ? `${consoleText}\n` : '',
            'utf8',
        ),
        writeFile(
            path.join(ARTIFACT_DIR, 'console.json'),
            JSON.stringify({
                summary,
                entries: entries.map(serializeConsoleEntry),
            }, null, 2),
            'utf8',
        ),
    ]);
}

async function runCapture() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await buildProductionBundle();
    const sourceBuildFingerprint = await collectStillwaterSourceBuildFingerprint({
        rootDir: ROOT,
        distDirectory: DIST_DIRECTORY,
    });
    previewProcess = startPreviewServer();
    const targetUrl = createTargetUrl();
    await waitForServer(targetUrl, CONFIG.startupTimeoutMs);

    const win = createWindow();
    mainWindow = win;
    const consoleEntries = [];
    const processFailures = [];
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleEntries.push({
            timestamp: Date.now(),
            level,
            message,
            line,
            sourceId,
        });
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        processFailures.push({
            type: 'render-process-gone',
            timestamp: new Date().toISOString(),
            details,
        });
    });
    win.webContents.on('unresponsive', () => {
        processFailures.push({
            type: 'unresponsive',
            timestamp: new Date().toISOString(),
        });
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
        processFailures.push({
            type: 'did-fail-load',
            timestamp: new Date().toISOString(),
            errorCode,
            errorDescription,
            validatedUrl,
        });
    });

    if (CONFIG.headed) {
        win.show();
        win.focus();
    }

    const gpuDiagnostics = await collectElectronGpuDiagnostics();
    let boot = null;
    let liveLayout = null;
    let screenshot = null;
    let fatalError = null;
    try {
        await win.loadURL(targetUrl);
        boot = await executePageFunction(
            win,
            bootstrapStillwaterPage,
            {
                quality: CONFIG.quality,
                targetFps: CONFIG.targetFps,
                startupTimeoutMs: CONFIG.startupTimeoutMs,
                expectBackend: CONFIG.expectBackend,
            },
            CONFIG.startupTimeoutMs + 90000,
            'bootstrapStillwaterPage',
        );
        if (boot?.ok) {
            liveLayout = await executePageFunction(
                win,
                startLiveLocalMultiplayerPage,
                {
                    players: CONFIG.players,
                    expectedLayout: CONFIG.expectedLayout,
                    matchTimeoutMs: CONFIG.matchTimeoutMs,
                    settleMs: CONFIG.settleMs,
                },
                CONFIG.matchTimeoutMs + 60000,
                'startLiveLocalMultiplayerPage',
            );
        }
        screenshot = await captureScreenshot(win);
    } catch (error) {
        fatalError = {
            message: error?.message || String(error),
            stack: error?.stack || null,
        };
        if (!win.isDestroyed()) {
            try {
                screenshot = await captureScreenshot(win);
            } catch {
                // The JSON/console evidence remains useful if capturePage failed.
            }
        }
    }

    const consoleSummary = summarizeConsole(consoleEntries, processFailures);
    await writeConsoleArtifacts(consoleEntries, consoleSummary);
    const pass = boot?.ok === true
        && liveLayout?.ok === true
        && consoleSummary.ok
        && !fatalError;
    const summary = {
        generatedAt: new Date().toISOString(),
        targetUrl,
        artifactDir: ARTIFACT_DIR,
        sourceBuildFingerprint,
        pass,
        config: CONFIG,
        gpuDiagnostics,
        boot,
        liveLayout,
        screenshot,
        consoleSummary,
        fatalError,
    };
    const summaryPath = path.join(
        ARTIFACT_DIR,
        `stillwater-live-local-${PLAYERS}p.json`,
    );
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(
        `[StillwaterLiveLayout] ${pass ? 'PASS' : 'FAIL'} ${PLAYERS}P`
        + ` - ${path.relative(ROOT, summaryPath)}`,
    );
    return pass;
}

async function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    } catch {
        // Best effort.
    }
    mainWindow = null;
    try {
        await stopPreviewServer();
    } catch (error) {
        console.error('[StillwaterLiveLayout] Preview shutdown failed:', error);
    }
    try {
        await app.quit();
    } catch {
        // Best effort.
    }
    process.exit(exitCode);
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (!parseBoolean(ARGS['allow-low-power-gpu'], false)) {
    app.commandLine.appendSwitch('force_high_performance_gpu');
}

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

app.whenReady().then(async () => {
    try {
        const passed = await runCapture();
        await shutdown(passed ? 0 : 1);
    } catch (error) {
        console.error(
            '[StillwaterLiveLayout] FAILED:',
            error?.stack || error?.message || error,
        );
        await mkdir(ARTIFACT_DIR, { recursive: true });
        await writeFile(
            path.join(ARTIFACT_DIR, 'fatal-error.log'),
            `${error?.stack || error?.message || error}\n`,
            'utf8',
        );
        await shutdown(1);
    }
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
