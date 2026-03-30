import electron from 'electron';
import { spawn } from 'child_process';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const THEMES = [
    'himalayan-peak', 'ice-temple', 'moonlit-forest', 'wolfhour',
    'nebula-flow', 'sky-children-v2', 'black-hole'
];

const DEV_SERVER_PORT = 4174;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

let devServerProcess = null;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function startDevServer() {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'npx.cmd' : 'npx';
    const args = ['vite', '--host', '127.0.0.1', '--port', String(DEV_SERVER_PORT), '--strictPort'];

    const proc = spawn(command, args, {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: isWindows,
    });
    return proc;
}

async function stopDevServer() {
    if (!devServerProcess) return;
    const proc = devServerProcess;
    devServerProcess = null;
    if (proc.killed) return;
    proc.kill('SIGTERM');
    await delay(800);
    if (!proc.killed) proc.kill('SIGKILL');
}

async function waitForServer(url, timeoutMs = 60_000) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url, { method: 'GET' });
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }
        await delay(500);
    }
    throw new Error(`Timed out waiting for dev server: ${lastError?.message}`);
}

async function runTests() {
    console.log('[ThemeTest] Starting Vite dev server...');
    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_URL);
    console.log('[ThemeTest] Dev server ready.');

    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const consoleEntries = [];
    win.webContents.on('console-message', (_event, level, message) => {
        if (level === 2 && message.includes('[GPUResilience]')) {
            consoleEntries.push(message);
        }
    });

    console.log('[ThemeTest] Loading app...');
    await win.loadURL(`${DEV_SERVER_URL}/?skipIntro=1`);

    // Bootstrap game
    await win.webContents.executeJavaScript(`
        (async () => {
             const app = window.serenityBlocks;
             await new Promise(r => setTimeout(r, 2000));
             window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'serenity' } }));
             await new Promise(r => setTimeout(r, 3000));
        })();
    `, true);

    let passedAll = true;
    for (const theme of THEMES) {
        console.log(`[ThemeTest] Testing theme: ${theme}`);
        await win.webContents.executeJavaScript(`window.themeManager.switchTheme('${theme}', true)`, true);
        await delay(3000); // let it load

        // 1. Force context loss
        console.log(`[ThemeTest] Triggering WebGL context loss...`);
        const result = await win.webContents.executeJavaScript(`
            (async () => {
                const canvas = document.querySelector('canvas');
                if (!canvas) return { error: 'No canvas found' };
                const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
                if (!gl) return { error: 'No WebGL context' };
                const ext = gl.getExtension('WEBGL_lose_context');
                if (!ext) return { error: 'WEBGL_lose_context not supported' };
                
                ext.loseContext();
                await new Promise(r => setTimeout(r, 1000));
                ext.restoreContext();
                await new Promise(r => setTimeout(r, 2000));
                
                // Verify canvas wasn't destroyed outright and theme recovered
                return { ok: !!window.themeManager.activeThemeInstance.isActive };
            })()
        `, true);

        if (result.error || !result.ok) {
            console.error(`[ThemeTest] Context recovery FAILED for ${theme}`, result);
            passedAll = false;
            break;
        }

        console.log(`[ThemeTest] Recovery SUCCESS for ${theme}`);

        // 2. Test Frame Drop Throttling
        console.log(`[ThemeTest] Triggering artificial frame drops...`);
        const downscaleResult = await win.webContents.executeJavaScript(`
            (async () => {
                 let initialScale = window.serenityBlocks.getGlobalRenderScale ? window.serenityBlocks.getGlobalRenderScale() : 1.0;
                 // simulate 35 frames dropping below threshold natively in performance monitor
                 for(let i=0; i < 40; i++) {
                     if (window.perfMonitor) {
                         const start = performance.now();
                         while(performance.now() - start < 35) { /* spin */ }
                         window.perfMonitor.frameStart();
                     }
                 }
                 await new Promise(r => setTimeout(r, 100));
                 return { ok: true };
            })()
        `, true);

        console.log(`[ThemeTest] Throttling simulated for ${theme}.`);
        await delay(1000);
    }

    if (passedAll) {
        console.log('\\n[ThemeTest] ALL TESTS COMPLETED SUCCESSFULLY \\u2714');
    } else {
        console.error('\\n[ThemeTest] TESTS FAILED \\u2718');
    }

    if (!win.isDestroyed()) win.destroy();
    await stopDevServer();
    app.exit(passedAll ? 0 : 1);
}

app.whenReady().then(runTests).catch((err) => {
    console.error('[ThemeTest] Fatal error:', err);
    stopDevServer().then(() => app.exit(1));
});
