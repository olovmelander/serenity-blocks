/**
 * Odyssey WebGPU validation harness.
 *
 * Boots the dev server, opens the standalone pilot page for each converted scene, and
 * scans the browser console for WGSL / ShaderModule / RenderPipeline / TSL errors —
 * a headless regression check for the GLSL→TSL/WebGPU migration. Captures one PNG per
 * scene for visual diffing.
 *
 * Usage:
 *   npm run validate:odyssey:webgpu                 # WebGPU backend
 *   ODYSSEY_FORCE_WEBGL=1 npm run validate:odyssey:webgpu   # WebGL2 fallback backend
 *
 * Exits non-zero if any scene logged a shader/pipeline error (CI-friendly).
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
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'webgpu-validation', FORCE_WEBGL ? 'webgl2' : 'webgpu');

const SCENES = [
    'deep-ocean', 'earth-core', 'mountain-peaks', 'sky-drift', 'cosmic-expanse',
    'black-hole-transcendence', 'urban-dreams', 'path', 'level-nodes', 'threshold-breach',
];

const SHADER_ERR = /WGSL|ShaderModule|RenderPipeline|No stack defined|not declared|TSL:|uv.*not found|attribute.*not found/i;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let devServer = null;

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
        const errors = [];
        const onConsole = (_e, _level, message) => { if (SHADER_ERR.test(message)) errors.push(message.slice(0, 200)); };
        win.webContents.on('console-message', onConsole);

        const flags = `chapter=${scene}${FORCE_WEBGL ? '&forceWebGL=1' : ''}`;
        await win.loadURL(`http://127.0.0.1:${PORT}/odyssey-webgpu-pilot.html?${flags}`);
        await delay(2500); // let the scene compile + render a few frames

        const png = await win.webContents.capturePage();
        await writeFile(path.join(ARTIFACT_DIR, `${scene}.png`), png.toPNG());
        win.webContents.off('console-message', onConsole);

        const ok = errors.length === 0;
        results.push({ scene, ok, errors });
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${scene}${ok ? '' : `\n    ${errors.join('\n    ')}`}`);
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} scenes clean (${FORCE_WEBGL ? 'WebGL2' : 'WebGPU'} backend) ===`);
    await writeFile(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify(results, null, 2));
    win.destroy();
    return failed.length === 0 ? 0 : 1;
}

app.whenReady().then(async () => {
    let code = 1;
    try { code = await run(); } catch (e) { console.error('validation failed:', e?.stack || e); }
    finally {
        if (devServer && !devServer.killed) { devServer.kill('SIGTERM'); await delay(600); if (!devServer.killed) devServer.kill('SIGKILL'); }
        app.exit(code);
    }
});
