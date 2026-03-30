import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electron from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const APP_MAIN_PATH = path.join(ROOT, 'electron', 'main.js');
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.mjs');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'windows-devtools-smoke', TIMESTAMP);
const HTML_PATH = path.join(ARTIFACT_DIR, 'smoke.html');
const STEAMWORKS_STUB_PATH = path.join(ARTIFACT_DIR, 'steamworks-stub.mjs');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'report.json');
const SHOW_WINDOW = process.env.SERENITY_SHOW_WINDOW !== '0';
const DEVTOOLS_TIMEOUT_MS = 4000;
const REMOTE_DEBUGGING_PORT = Number.parseInt(process.env.SERENITY_REMOTE_DEBUGGING_PORT || '9222', 10);
const REMOTE_DEBUGGING_URL = Number.isInteger(REMOTE_DEBUGGING_PORT)
    ? `http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`
    : null;
const { app, BrowserWindow } = electron;

if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-dev-shm-usage');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushEvent(report, type, extra = {}) {
    report.events.push({
        timestamp: new Date().toISOString(),
        type,
        ...extra,
    });
}

function countEvents(report, type) {
    return report.events.filter((event) => event.type === type).length;
}

function httpGetText(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode ?? null,
                    body,
                });
            });
        });

        request.setTimeout(1500, () => {
            request.destroy(new Error('Request timed out'));
        });
        request.on('error', reject);
    });
}

async function probeRemoteInspector() {
    if (!REMOTE_DEBUGGING_URL) {
        return {
            enabled: false,
            ok: false,
            error: 'Remote debugging port not configured.',
        };
    }

    let lastError = null;
    for (let attempt = 1; attempt <= 16; attempt += 1) {
        try {
            const response = await httpGetText(`${REMOTE_DEBUGGING_URL}/json/version`);
            return {
                enabled: true,
                ok: response.statusCode === 200,
                statusCode: response.statusCode,
                bodySnippet: response.body.slice(0, 500),
                attempt,
            };
        } catch (error) {
            lastError = error.message;
            await delay(250);
        }
    }

    return {
        enabled: true,
        ok: false,
        error: lastError,
    };
}

async function waitForCondition(predicate, description, timeoutMs = DEVTOOLS_TIMEOUT_MS) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        const value = await predicate();
        if (value) {
            return {
                ok: true,
                elapsedMs: Date.now() - startedAt,
            };
        }
        await delay(50);
    }

    throw new Error(`Timed out waiting for ${description}`);
}

function waitForMainWindow() {
    const existingWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (existingWindow) {
        return Promise.resolve(existingWindow);
    }

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            app.removeListener('browser-window-created', handleWindowCreated);
            reject(new Error('Timed out waiting for the Serenity Blocks main window'));
        }, 10000);

        function handleWindowCreated(_event, window) {
            clearTimeout(timeoutId);
            app.removeListener('browser-window-created', handleWindowCreated);
            resolve(window);
        }

        app.on('browser-window-created', handleWindowCreated);
    });
}

async function waitForDidFinishLoad(win, report) {
    if (!win.webContents.isLoadingMainFrame() && win.webContents.getURL()) {
        return;
    }

    await new Promise((resolve) => {
        win.webContents.once('did-finish-load', () => {
            pushEvent(report, 'did-finish-load');
            resolve();
        });
    });
}

async function focusMainWindow(win) {
    if (win.isMinimized()) {
        win.restore();
    }
    if (!win.isVisible()) {
        win.show();
    }

    win.focus();
    await delay(180);
}

async function sendShortcutSequence(win, sequence, label, report) {
    await focusMainWindow(win);
    pushEvent(report, 'shortcut-dispatched', {
        label,
        sequence: sequence.map((event) => ({
            type: event.type,
            keyCode: event.keyCode,
            modifiers: event.modifiers || [],
        })),
    });

    sequence.forEach((event) => {
        win.webContents.sendInputEvent(event);
    });
}

async function invokeRendererOpenDevTools(win) {
    return win.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
            let request = null;
            let unsubscribe = null;
            const timeoutId = window.setTimeout(() => {
                unsubscribe?.();
                reject(new Error('Timed out waiting for the DevTools runtime event.'));
            }, ${DEVTOOLS_TIMEOUT_MS});

            const finish = (value) => {
                window.clearTimeout(timeoutId);
                unsubscribe?.();
                resolve(value);
            };

            const fail = (message) => {
                window.clearTimeout(timeoutId);
                unsubscribe?.();
                reject(new Error(message));
            };

            unsubscribe = window.electronAPI.onRuntimeEvent((payload) => {
                if (!payload?.type || !request || payload.requestId !== request.requestId) {
                    return;
                }

                if (payload.type === 'devtools-opened') {
                    finish({ request, event: payload });
                    return;
                }

                if (payload.type === 'devtools-open-failed') {
                    fail(payload.failureKind || 'DevTools open failed.');
                }
            });

            window.electronAPI.openDevTools().then((result) => {
                request = result;
                if (!request?.accepted || !request?.requestId) {
                    fail('Main process did not accept the DevTools request.');
                }
            }).catch((error) => {
                fail(error.message);
            });
        });
    `, true);
}

async function getDevToolsDiagnostics(win) {
    return win.webContents.executeJavaScript(
        'window.electronAPI.getDevToolsDiagnostics()',
        true,
    );
}

async function isDevToolsReportedOpen(win) {
    const diagnostics = await getDevToolsDiagnostics(win);
    return Boolean(diagnostics?.isOpen);
}

async function createSmokeHtml() {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Serenity Blocks DevTools Smoke</title>
    <style>
      body {
        margin: 0;
        font-family: sans-serif;
        background: #10141f;
        color: #f5f7ff;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      .card {
        padding: 24px;
        border-radius: 16px;
        background: rgba(22, 27, 43, 0.92);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Serenity Blocks DevTools Smoke Test</h1>
      <p id="ready-state">Renderer ready.</p>
    </div>
  </body>
</html>
`;

    await writeFile(HTML_PATH, html, 'utf8');
}

async function createSteamworksStub() {
    const stub = `export const SteamCallback = {
  GameLobbyJoinRequested: 'GameLobbyJoinRequested',
  SteamServersConnected: 'SteamServersConnected',
  SteamServersDisconnected: 'SteamServersDisconnected',
  SteamServerConnectFailure: 'SteamServerConnectFailure',
};

export function init(appId) {
  return {
    appId,
    localplayer: {
      getSteamId() {
        return { steamId64: '76561197960287930' };
      },
      getName() {
        return 'Smoke Tester';
      },
    },
    callback: {
      register() {
        return {
          disconnect() {},
        };
      },
    },
    utils: {
      getServerRealTime() {
        return Math.floor(Date.now() / 1000);
      },
    },
    friends: {
      clearRichPresence() {},
    },
  };
}

export default {
  init,
  SteamCallback,
};
`;

    await writeFile(STEAMWORKS_STUB_PATH, stub, 'utf8');
}

async function main() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await createSmokeHtml();
    await createSteamworksStub();

    if (!SHOW_WINDOW) {
        throw new Error('SERENITY_SHOW_WINDOW=0 is not supported for shortcut smoke validation.');
    }
    if (!existsSync(APP_MAIN_PATH)) {
        throw new Error(`Missing Electron main entry: ${APP_MAIN_PATH}`);
    }
    if (!existsSync(PRELOAD_PATH)) {
        throw new Error(`Missing preload script: ${PRELOAD_PATH}`);
    }

    process.env.SERENITY_DEVTOOLS_SMOKE = '1';
    process.env.SERENITY_DEVTOOLS_SMOKE_FILE = HTML_PATH;
    process.env.SERENITY_OPEN_DEVTOOLS = '0';
    process.env.STEAMWORKS_MODULE = STEAMWORKS_STUB_PATH;
    delete process.env.SERENITY_DISABLE_STEAM_BOOTSTRAP;
    if (REMOTE_DEBUGGING_URL) {
        process.env.SERENITY_REMOTE_DEBUGGING_PORT = String(REMOTE_DEBUGGING_PORT);
    }

    const report = {
        startedAt: new Date().toISOString(),
        artifactDir: ARTIFACT_DIR,
        htmlPath: HTML_PATH,
        steamworksStubPath: STEAMWORKS_STUB_PATH,
        reportPath: REPORT_PATH,
        appMainPath: APP_MAIN_PATH,
        preloadPath: PRELOAD_PATH,
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        remoteDebuggingPort: REMOTE_DEBUGGING_PORT,
        remoteDebuggingUrl: REMOTE_DEBUGGING_URL,
        showWindow: true,
        events: [],
        tests: {},
        devTools: {
            isOpenBefore: false,
            isOpenAfterTests: false,
            diagnostics: null,
        },
        remoteInspector: null,
    };

    const mainWindowPromise = waitForMainWindow();
    await import(pathToFileURL(APP_MAIN_PATH).href);
    await app.whenReady();

    const win = await mainWindowPromise;
    win.webContents.on('did-finish-load', () => {
        pushEvent(report, 'did-finish-load');
    });
    win.webContents.on('devtools-opened', () => {
        pushEvent(report, 'devtools-opened', {
            isOpen: !win.isDestroyed() ? win.webContents.isDevToolsOpened() : null,
        });
    });
    win.webContents.on('devtools-closed', () => {
        pushEvent(report, 'devtools-closed', {
            isOpen: !win.isDestroyed() ? win.webContents.isDevToolsOpened() : null,
        });
    });

    await waitForDidFinishLoad(win, report);
    await focusMainWindow(win);

    report.devTools.isOpenBefore = await isDevToolsReportedOpen(win);
    if (report.devTools.isOpenBefore) {
        throw new Error('DevTools was already open before shortcut smoke validation started.');
    }

    const f12OpenedBefore = countEvents(report, 'devtools-opened');
    const f12ClosedBefore = countEvents(report, 'devtools-closed');
    await sendShortcutSequence(win, [
        { type: 'rawKeyDown', keyCode: 'F12' },
        { type: 'keyDown', keyCode: 'F12' },
        { type: 'keyUp', keyCode: 'F12' },
    ], 'f12-dedup-open', report);
    const f12OpenResult = await waitForCondition(
        () => isDevToolsReportedOpen(win),
        'DevTools to open from F12',
    );
    await delay(250);
    report.tests.f12 = {
        elapsedMs: f12OpenResult.elapsedMs,
        openedEvents: countEvents(report, 'devtools-opened') - f12OpenedBefore,
        closedEvents: countEvents(report, 'devtools-closed') - f12ClosedBefore,
        isOpenAfter: await isDevToolsReportedOpen(win),
    };
    if (report.tests.f12.closedEvents !== 0 || !report.tests.f12.isOpenAfter) {
        throw new Error('F12 shortcut did not open DevTools without an immediate close.');
    }

    await sendShortcutSequence(win, [
        { type: 'keyDown', keyCode: 'F12' },
        { type: 'keyUp', keyCode: 'F12' },
    ], 'f12-close', report);
    await waitForCondition(
        async () => !(await isDevToolsReportedOpen(win)),
        'DevTools to close from F12',
    );

    const altOpenedBefore = countEvents(report, 'devtools-opened');
    const altClosedBefore = countEvents(report, 'devtools-closed');
    await sendShortcutSequence(win, [
        { type: 'keyDown', keyCode: 'I', modifiers: ['control', 'shift'] },
        { type: 'keyUp', keyCode: 'I', modifiers: ['control', 'shift'] },
    ], 'ctrl-shift-i-open', report);
    const ctrlShiftIOpenResult = await waitForCondition(
        () => isDevToolsReportedOpen(win),
        'DevTools to open from Ctrl+Shift+I',
    );
    await delay(250);
    report.tests.ctrlShiftI = {
        elapsedMs: ctrlShiftIOpenResult.elapsedMs,
        openedEvents: countEvents(report, 'devtools-opened') - altOpenedBefore,
        closedEvents: countEvents(report, 'devtools-closed') - altClosedBefore,
        isOpenAfter: await isDevToolsReportedOpen(win),
    };
    if (report.tests.ctrlShiftI.closedEvents !== 0 || !report.tests.ctrlShiftI.isOpenAfter) {
        throw new Error('Ctrl+Shift+I shortcut did not open DevTools without an immediate close.');
    }

    await sendShortcutSequence(win, [
        { type: 'keyDown', keyCode: 'F12' },
        { type: 'keyUp', keyCode: 'F12' },
    ], 'ctrl-shift-i-close-via-f12', report);
    await waitForCondition(
        async () => !(await isDevToolsReportedOpen(win)),
        'DevTools to close after Ctrl+Shift+I validation',
    );

    const rendererButtonResult = await invokeRendererOpenDevTools(win);
    await waitForCondition(
        () => isDevToolsReportedOpen(win),
        'DevTools to open from renderer button request',
    );
    report.tests.rendererButton = {
        requestId: rendererButtonResult.request.requestId,
        alreadyOpen: Boolean(rendererButtonResult.request.alreadyOpen),
        eventType: rendererButtonResult.event.type,
        eventAlreadyOpen: Boolean(rendererButtonResult.event.alreadyOpen),
        isOpenAfter: await isDevToolsReportedOpen(win),
    };
    if (report.tests.rendererButton.alreadyOpen || !report.tests.rendererButton.isOpenAfter) {
        throw new Error('Renderer button request did not perform an open from the closed state.');
    }

    const alreadyOpenResult = await invokeRendererOpenDevTools(win);
    report.tests.rendererButtonAlreadyOpen = {
        requestId: alreadyOpenResult.request.requestId,
        alreadyOpen: Boolean(alreadyOpenResult.request.alreadyOpen),
        eventType: alreadyOpenResult.event.type,
        eventAlreadyOpen: Boolean(alreadyOpenResult.event.alreadyOpen),
        isOpenAfter: await isDevToolsReportedOpen(win),
    };
    if (!report.tests.rendererButtonAlreadyOpen.alreadyOpen || !report.tests.rendererButtonAlreadyOpen.eventAlreadyOpen) {
        throw new Error('Renderer button request did not resolve immediately when DevTools was already open.');
    }

    report.devTools.diagnostics = await getDevToolsDiagnostics(win);
    report.devTools.isOpenAfterTests = await isDevToolsReportedOpen(win);
    report.devTools.logPath = report.devTools.diagnostics?.logPath || null;
    report.devTools.pendingOpenRequestCount = report.devTools.diagnostics?.pendingOpenRequests?.length || 0;
    report.devTools.entriesTail = report.devTools.diagnostics?.entries?.slice(-16) || [];

    const diagnosticTypes = new Set((report.devTools.diagnostics?.entries || []).map((entry) => entry.type));
    if (!diagnosticTypes.has('devtools-shortcut-handled')) {
        throw new Error('DevTools diagnostics did not record a handled shortcut event.');
    }
    if (!diagnosticTypes.has('devtools-shortcut-deduped')) {
        throw new Error('DevTools diagnostics did not record a deduped shortcut event.');
    }
    if (!diagnosticTypes.has('managed-devtools-host-created')) {
        throw new Error('DevTools diagnostics did not record managed DevTools host creation.');
    }
    if (!diagnosticTypes.has('managed-devtools-host-shown')) {
        throw new Error('DevTools diagnostics did not record managed DevTools host display.');
    }
    if (!diagnosticTypes.has('managed-devtools-host-skipped-by-overlay')) {
        throw new Error('DevTools diagnostics did not record the overlay hook skipping the managed DevTools host.');
    }
    if (report.devTools.pendingOpenRequestCount !== 0) {
        throw new Error('DevTools diagnostics still show pending open requests after smoke validation.');
    }
    if (report.devTools.diagnostics?.managedHostWindow?.role !== 'managed-devtools-host') {
        throw new Error('DevTools diagnostics did not report the managed host window role.');
    }

    report.remoteInspector = await probeRemoteInspector();
    report.finishedAt = new Date().toISOString();

    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    if (!win.isDestroyed()) {
        win.destroy();
    }

    app.exit(0);
}

main().catch(async (error) => {
    const failureReport = {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        errorMessage: error.message,
        errorStack: error.stack || null,
        remoteDebuggingUrl: REMOTE_DEBUGGING_URL,
        reportPath: REPORT_PATH,
    };

    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(failureReport, null, 2)}\n`, 'utf8');
    console.error('[windows-devtools-smoke] Failed:', error);
    app.exit(1);
});
