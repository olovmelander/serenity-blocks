/**
 * Odyssey WebGPU validation harness (remediation plan §3c).
 *
 * Boots the dev server, opens the standalone pilot page for each converted scene,
 * waits for a real readiness signal, ASSERTS the backend actually initialized
 * (a silent WebGL2 fallback in the WebGPU leg fails loudly), and scans for
 * WGSL / ShaderModule / RenderPipeline / TSL errors — a headless regression
 * check for the GLSL→TSL/WebGPU migration. Captures one PNG per scene.
 *
 * Usage:
 *   npm run validate:odyssey:webgpu                        # WebGPU backend (asserts WebGPU)
 *   ODYSSEY_FORCE_WEBGL=1 npm run validate:odyssey:webgpu  # WebGL2 fallback (asserts WebGL2)
 * Env:
 *   ODYSSEY_VALIDATION_SCENES=deep-ocean,path   # optional subset (default: all)
 *   ODYSSEY_VALIDATION_READY_TIMEOUT_MS=90000    # per-scene readiness budget (software raster is slow)
 *   ODYSSEY_SHOW_WINDOW=1                         # show the window (debugging)
 *
 * Exits non-zero if any scene failed to signal ready, initialized the wrong
 * backend, or logged a shader/pipeline error (CI-friendly). The full scene list
 * is pinned ⊇ the chapter registry by tests/unit/odyssey-gpu-gate-coverage.test.js.
 */

import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const PORT = Number(process.env.ODYSSEY_VALIDATION_PORT || 4178);
const FORCE_WEBGL = process.env.ODYSSEY_FORCE_WEBGL === '1';
const SHOW = process.env.ODYSSEY_SHOW_WINDOW === '1';
const READY_TIMEOUT_MS = Number(process.env.ODYSSEY_VALIDATION_READY_TIMEOUT_MS || 90000);
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'webgpu-validation', FORCE_WEBGL ? 'webgl2' : 'webgpu');

// Every chapter in the chapter registry (CHAPTER_SCENES) plus the 3 non-chapter
// pilot scenes. Chapter 3 (surface-world) was silently exempt for months.
// Pinned ⊇ the registry by tests/unit/odyssey-gpu-gate-coverage.test.js.
const ALL_SCENES = [
    'deep-ocean', 'earth-core', 'surface-world', 'mountain-peaks', 'sky-drift',
    'cosmic-expanse', 'black-hole-transcendence', 'urban-dreams',
    'path', 'level-nodes', 'threshold-breach',
];
const SCENE_FILTER = (process.env.ODYSSEY_VALIDATION_SCENES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
const SCENES = SCENE_FILTER.length ? ALL_SCENES.filter((s) => SCENE_FILTER.includes(s)) : ALL_SCENES;

const SHADER_ERR = /WGSL|ShaderModule|RenderPipeline|No stack defined|not declared|TSL:|uv.*not found|attribute.*not found/i;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let devServer = null;

// Headless-Linux GPU switches. The WebGPU leg needs Dawn + a SwiftShader/Vulkan
// adapter; the forceWebGL leg needs a GL context (SwiftShader). Harmless on a
// real GPU. Must be applied before the app 'ready' event.
function applyGpuSwitches() {
    app.commandLine.appendSwitch('no-sandbox');
    // CI containers give Chromium a tiny/locked /dev/shm; without this the GPU
    // and utility processes FATAL on shared-memory creation and nothing renders.
    app.commandLine.appendSwitch('disable-dev-shm-usage');
    // Route GL through ANGLE→SwiftShader so the WebGL2 backend has a software
    // rasterizer on driverless runners (verified locally via Chromium/CDP).
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    // Run GPU work in the browser process, eliminating the separate GPU process
    // that crash-loops on shared-memory creation on hosted CI runners.
    app.commandLine.appendSwitch('in-process-gpu');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    if (!FORCE_WEBGL) {
        app.commandLine.appendSwitch('enable-unsafe-webgpu');
        app.commandLine.appendSwitch('enable-features', 'Vulkan');
        app.commandLine.appendSwitch('use-webgpu-adapter', 'swiftshader');
    }
}

function startDevServer() {
    const proc = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '0' },
    });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    return proc;
}

async function waitForServer(url, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try { if ((await fetch(url)).ok) return; } catch { /* keep polling */ }
        await delay(400);
    }
    throw new Error(`dev server not ready: ${url}`);
}

// Poll the pilot's readiness contract instead of a fixed delay (plan §3c.3).
async function waitForReady(win, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ready = await win.webContents
            .executeJavaScript('window.__ODYSSEY_PILOT_READY__ === true')
            .catch(() => false);
        if (ready === true) return true;
        await delay(250);
    }
    return false;
}

async function run() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    devServer = startDevServer();
    await waitForServer(`http://127.0.0.1:${PORT}/odyssey-webgpu-pilot.html`);

    const win = new BrowserWindow({
        width: 1280, height: 720, show: SHOW,
        webPreferences: { offscreen: false, backgroundThrottling: false },
    });

    const results = [];
    for (const scene of SCENES) {
        const consoleErrors = [];
        const onConsole = (_e, _level, message) => { if (SHADER_ERR.test(message)) consoleErrors.push(message.slice(0, 200)); };
        win.webContents.on('console-message', onConsole);

        const flags = `chapter=${scene}${FORCE_WEBGL ? '&forceWebGL=1' : ''}`;
        let ready = false;
        let backend = null;
        let pageErrors = [];
        try {
            await win.loadURL(`http://127.0.0.1:${PORT}/odyssey-webgpu-pilot.html?${flags}`);
            ready = await waitForReady(win, READY_TIMEOUT_MS);
            if (ready) {
                backend = await win.webContents.executeJavaScript('window.__ODYSSEY_PILOT_BACKEND__').catch(() => null);
                pageErrors = await win.webContents.executeJavaScript('(window.__ODYSSEY_PILOT_ERRORS__ || []).slice(0, 20)').catch(() => []);
            }
        } catch (e) {
            consoleErrors.push(`load failed: ${(e?.message || e)}`.slice(0, 200));
        }

        // Backend-init assertion (plan §3c.2): a silent fallback must fail loudly,
        // so the "WebGPU" leg actually compiles WGSL rather than WebGL2.
        const expected = FORCE_WEBGL ? 'WebGL2' : 'WebGPU';
        const backendOk = FORCE_WEBGL ? backend?.isWebGL === true : backend?.isWebGPU === true;

        const reasons = [];
        if (!ready) reasons.push(`scene never signalled ready within ${READY_TIMEOUT_MS}ms`);
        if (ready && !backendOk) reasons.push(`backend did not initialize as ${expected} (got ${backend?.backendName || 'unknown'})`);
        const shaderErrors = [...new Set([...consoleErrors, ...pageErrors].filter((m) => SHADER_ERR.test(String(m))))];
        if (shaderErrors.length) reasons.push(...shaderErrors.map((m) => String(m).slice(0, 200)));

        const png = await win.webContents.capturePage();
        await writeFile(path.join(ARTIFACT_DIR, `${scene}.png`), png.toPNG());
        win.webContents.off('console-message', onConsole);

        const ok = reasons.length === 0;
        results.push({ scene, ok, backend: backend?.backendName || 'unknown', reasons });
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${scene}  [${backend?.backendName || 'unknown'}]${ok ? '' : `\n    ${reasons.join('\n    ')}`}`);
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} scenes clean (${FORCE_WEBGL ? 'WebGL2' : 'WebGPU'} backend) ===`);
    await writeFile(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify(results, null, 2));
    win.destroy();
    return failed.length === 0 ? 0 : 1;
}

applyGpuSwitches();
app.whenReady().then(async () => {
    let code = 1;
    try { code = await run(); } catch (e) { console.error('validation failed:', e?.stack || e); }
    finally {
        if (devServer && !devServer.killed) { devServer.kill('SIGTERM'); await delay(600); if (!devServer.killed) devServer.kill('SIGKILL'); }
        app.exit(code);
    }
});
