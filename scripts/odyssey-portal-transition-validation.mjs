import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const DEV_SERVER_PORT = Number(process.env.ODYSSEY_VALIDATION_PORT || 4176);
const DEV_SERVER_BASE_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const URL_FLAGS = process.env.ODYSSEY_VALIDATION_URL_FLAGS || 'skipIntro=1&odysseyPortalTransitionV2=1';
const DEV_SERVER_URL = `${DEV_SERVER_BASE_URL}/?${URL_FLAGS}`;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'portal-transition', TIMESTAMP);

let devServerProcess = null;
const consoleLines = [];

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // ignore
        }
        await delay(400);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function startDevServer() {
    const proc = spawn(
        'npm',
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_SERVER_PORT), '--strictPort'],
        {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                FORCE_COLOR: '0',
            },
        },
    );

    proc.stdout.on('data', (chunk) => {
        consoleLines.push(String(chunk));
    });

    proc.stderr.on('data', (chunk) => {
        consoleLines.push(String(chunk));
    });

    return proc;
}

async function stopDevServer() {
    if (!devServerProcess) return;

    const proc = devServerProcess;
    devServerProcess = null;

    if (!proc.killed) {
        proc.kill('SIGTERM');
        await delay(800);
        if (!proc.killed) proc.kill('SIGKILL');
    }
}

function createWindow() {
    return new BrowserWindow({
        width: 1600,
        height: 900,
        show: process.env.ODYSSEY_VALIDATION_SHOW_WINDOW === '1',
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
}

function analyzeImageMetrics(image) {
    const bitmap = image.toBitmap();
    const { width, height } = image.getSize();
    const totalPixels = Math.max(1, width * height);
    const stride = 4;
    const sampleStep = Math.max(1, Math.floor(totalPixels / 20000));

    let sampled = 0;
    let lumaSum = 0;
    let blackCount = 0;

    for (let p = 0; p < totalPixels; p += sampleStep) {
        const i = p * stride;
        const b = bitmap[i];
        const g = bitmap[i + 1];
        const r = bitmap[i + 2];
        const a = bitmap[i + 3];

        if (a === 0) continue;

        const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
        lumaSum += luma;
        sampled += 1;
        if (luma < 8) {
            blackCount += 1;
        }
    }

    if (sampled === 0) {
        return { meanLuma: 0, blackCoverage: 1 };
    }

    return {
        meanLuma: lumaSum / sampled,
        blackCoverage: blackCount / sampled,
    };
}

async function bootstrapOdyssey(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 90000) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    if (predicate()) return true;
                    await sleep(100);
                }
                return false;
            };

            const managersReady = await waitFor(() => !!window.serenityBlocks?.gameModeManager, 90000);
            if (!managersReady) {
                return { ok: false, reason: 'gameModeManager not ready' };
            }

            const gm = window.serenityBlocks.gameModeManager;

            try {
                if (gm.getCurrentModeId?.() !== 'odyssey') {
                    await gm.activateMode('odyssey');
                }
                if (!gm.getCurrentMode?.()?.isRunning) {
                    await gm.startCurrentMode?.();
                }
            } catch (error) {
                return { ok: false, reason: 'failed to activate odyssey: ' + (error?.message || String(error)) };
            }

            const modeReady = await waitFor(() => !!window.odysseyMode?.boardController, 120000);
            if (!modeReady) {
                return { ok: false, reason: 'odyssey board not ready' };
            }

            if (!window.testOdysseyLevel) {
                return { ok: false, reason: 'window.testOdysseyLevel unavailable' };
            }

            window.__odysseyPortalValidationStartedAt = performance.now();
            window.testOdysseyLevel(1);

            return { ok: true };
        })();
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function captureTimeline(win) {
    const captures = [];
    const intervalsMs = [
        0,
        40,
        80,
        120,
        160,
        220,
        300,
        380,
        460,
        540,
        650,
        760,
        900,
        1200,
        1550,
        1900,
        2300,
        2600,
        2750,
        2800,
        3000,
        3200,
        3400,
        3600,
        3700,
        4200,
        4800,
    ];

    const start = Date.now();
    for (let i = 0; i < intervalsMs.length; i++) {
        const due = start + intervalsMs[i];
        const waitMs = Math.max(0, due - Date.now());
        if (waitMs > 0) await delay(waitMs);

        const image = await win.webContents.capturePage();
        const metrics = analyzeImageMetrics(image);
        const png = image.toPNG();
        const filename = `frame-${String(i).padStart(2, '0')}-${intervalsMs[i]}ms.png`;
        await writeFile(path.join(ARTIFACT_DIR, filename), png);
        captures.push({
            filename,
            atMs: intervalsMs[i],
            meanLuma: Number(metrics.meanLuma.toFixed(2)),
            blackCoverage: Number(metrics.blackCoverage.toFixed(4)),
        });
    }

    return captures;
}

async function runValidation() {
    await mkdir(ARTIFACT_DIR, { recursive: true });

    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_BASE_URL);

    const win = createWindow();

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleLines.push(`[renderer:${level}] ${sourceId}:${line} ${message}`);
    });

    await win.loadURL(DEV_SERVER_URL);

    const bootstrap = await bootstrapOdyssey(win);
    if (!bootstrap?.ok) {
        throw new Error(`Bootstrap failed: ${bootstrap?.reason || 'unknown'}`);
    }

    const captures = await captureTimeline(win);
    const motionScoreForWindow = (fromMs, toMs) => {
        const windowFrames = captures.filter((frame) => frame.atMs >= fromMs && frame.atMs <= toMs);
        if (windowFrames.length < 2) return 0;

        let deltaSum = 0;
        for (let i = 1; i < windowFrames.length; i++) {
            deltaSum += Math.abs(windowFrames[i].meanLuma - windowFrames[i - 1].meanLuma);
            deltaSum += Math.abs((windowFrames[i].blackCoverage - windowFrames[i - 1].blackCoverage) * 255);
        }

        return Number((deltaSum / (windowFrames.length - 1)).toFixed(3));
    };

    const preBreachBlackSpike = captures.some(
        (frame) => frame.atMs <= 600 && frame.blackCoverage >= 0.96 && frame.meanLuma < 8,
    );
    const breachRevealGap = captures.some(
        (frame) => frame.atMs >= 650
            && frame.atMs <= 3800
            && frame.blackCoverage >= 0.98
            && frame.meanLuma < 6,
    );
    const orbReadabilityMotionScore = motionScoreForWindow(0, 650);
    const arrivalMotionScore = motionScoreForWindow(2600, 3600);
    const staticArrivalDetected = arrivalMotionScore < 1.2
        && captures.some((frame) => frame.atMs >= 2600 && frame.atMs <= 3600 && frame.meanLuma >= 200);

    const summary = {
        url: DEV_SERVER_URL,
        captures,
        preBreachBlackSpike,
        breachRevealGap,
        orbReadabilityMotionScore,
        arrivalMotionScore,
        staticArrivalDetected,
        consoleErrorCount: consoleLines.filter((line) => line.includes('GL_INVALID_OPERATION')).length,
        tooManyErrorsSeen: consoleLines.some((line) => line.includes('too many errors')),
        artifactDir: ARTIFACT_DIR,
    };

    await writeFile(
        path.join(ARTIFACT_DIR, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf8',
    );

    await writeFile(
        path.join(ARTIFACT_DIR, 'console.log'),
        consoleLines.join(''),
        'utf8',
    );

    await win.close();

    if (summary.preBreachBlackSpike || summary.breachRevealGap) {
        throw new Error(`Validation failed with coverage gap. See ${path.join(ARTIFACT_DIR, 'summary.json')}`);
    }

    if (summary.consoleErrorCount > 0 || summary.tooManyErrorsSeen) {
        throw new Error(`Validation failed with GL errors. See ${path.join(ARTIFACT_DIR, 'console.log')}`);
    }

    console.log('[OdysseyValidation] Completed successfully');
    console.log(`[OdysseyValidation] Artifacts: ${ARTIFACT_DIR}`);
}

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
    try {
        await runValidation();
        await stopDevServer();
        app.quit();
    } catch (error) {
        console.error('[OdysseyValidation] Failed:', error);
        await stopDevServer();
        app.exit(1);
    }
});

app.on('window-all-closed', () => {
    // Keep explicit quit flow in runValidation.
});
