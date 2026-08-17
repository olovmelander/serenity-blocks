/**
 * CH6 ASCENT SWEEP PROBE — which chapter-6 elements are visible during the climb?
 *
 * Owner report 2026-08-16 (post-ascent build): the black hole and the aurora appear
 * in the bright sky during the ascent, disappear, then reappear in space. This seeks
 * the real board across the ascent + gate stations and prints, per station, the
 * visibility + effective opacity of every ch6 element that could be the culprit —
 * including the NEW planet-aurora crown from the parallel session's work.
 *
 * Usage: PROBE_PORT=4194 node scripts/run-electron.mjs scripts/odyssey-ch6-ascent-sweep-probe.mjs
 */
/* eslint-disable import/no-extraneous-dependencies, no-console */
import electron from 'electron';
import { spawn } from 'child_process';

const { app, BrowserWindow } = electron;
const PORT = process.env.PROBE_PORT || '4194';
const SEEKS = String(process.env.PROBE_SEEKS || '0.55,0.62,0.66,0.70,0.725,0.7401,0.75,0.76,0.80')
    .split(',').map(Number).filter(Number.isFinite);
const lines = [];
let devServer = null;

app.commandLine.appendSwitch('force_high_performance_gpu');

function startDevServer() {
    return new Promise((resolve, reject) => {
        devServer = spawn('npx', ['vite', '--port', PORT, '--strictPort'], {
            cwd: process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const onData = (buf) => {
            if (String(buf).includes('ready in') || String(buf).includes('Local:')) resolve();
        };
        devServer.stdout.on('data', onData);
        devServer.stderr.on('data', onData);
        setTimeout(() => reject(new Error('dev server did not start')), 60000);
    });
}

async function main() {
    await startDevServer();
    await new Promise((r) => { setTimeout(r, 1500); });
    await app.whenReady();
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: true,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    win.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2) lines.push(`[${level}] ${message}`);
    });

    const params = new URLSearchParams({
        skipIntro: '1',
        odysseyAAA: '1',
        odysseyOverlay: '0',
        odysseyPixelRatio: '1',
        odysseyDisableAdaptiveQuality: '1',
        odysseyDisableBackgroundLoading: '1',
        odysseyCaptureChapters: '5,6,7',
        probeBust: String(Date.now()),
    });
    await win.loadURL(`http://127.0.0.1:${PORT}/?${params.toString()}`);

    await win.webContents.executeJavaScript(`
        (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            for (let i = 0; i < 100; i += 1) {
                if (window.serenityBlocks?.gameModeManager) break;
                await sleep(200);
            }
            const gm = window.serenityBlocks?.gameModeManager;
            if (gm && gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (gm && !gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            for (let i = 0; i < 150; i += 1) {
                const bc = window.odysseyMode?.boardController;
                if (bc?.environmentManager?.environments?.size >= 2) break;
                await sleep(200);
            }
            return true;
        })();
    `, true).catch((e) => console.log('activate threw:', e?.message));

    await new Promise((r) => { setTimeout(r, 8000); });

    const rows = await win.webContents.executeJavaScript(`
        (() => {
            const bc = window.odysseyMode?.boardController;
            if (!bc) return { boardController: false };
            const seeks = ${JSON.stringify(SEEKS)};
            const out = [];
            const effOpacity = (o) => {
                if (!o) return null;
                // Effective: 0 if any ancestor is invisible; else material.opacity (or 1).
                let node = o;
                while (node) { if (!node.visible) return 0; node = node.parent; }
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                const m = mats[0];
                return m ? (typeof m.opacity === 'number' ? m.opacity : 1) : 1;
            };
            const uni = (o, key) => o?.userData?.[key]?.value ?? null;
            seeks.forEach((pos) => {
                bc.cameraController.setCurrentPosition(pos);
                bc.cameraController.updateFollowPosition?.({ position: pos, direct: true });
                const blendState = bc.environmentManager?.getBlendState(pos) || null;
                bc.environmentManager?.updateVisibility(pos, { mode: 'progress', blendState });
                bc.environmentManager?.updateGlobalEnvironment(pos, blendState);
                const directorState = bc.director?.update?.(1/60, { ascentProgress: pos, blendState }) || null;
                bc.environmentManager?.update(1/60, bc.camera, pos, directorState);
                bc.time = 9;
                bc.renderOnce?.(0);

                const env = bc.environmentManager?.environments?.get(6) || null;
                const group = env?.group || env || null;
                if (!group) { out.push({ pos, missing: true }); return; }
                const ud = group.userData;
                // Find the planet aurora crown wherever it is parented.
                let planetAurora = null;
                group.traverse((o) => {
                    if (/aurora/i.test(o.name || '') && /planet|crown|oval/i.test(o.name || '')) planetAurora = o;
                });
                out.push({
                    pos,
                    chapterOpacity: ud.chapterOpacity ?? null,
                    groupVisible: group.visible,
                    spaceReveal: ud.summitEarthStaging?.spaceReveal ?? null,
                    earthReveal: ud.summitEarthStaging?.earthReveal ?? null,
                    bh: effOpacity(ud.blackHole?.children?.find((c) => c.name === 'accretion-disk') ?? ud.blackHole),
                    bhVisible: ud.blackHole ? ud.blackHole.visible : null,
                    planet: effOpacity(ud.heroPlanet?.userData?.planet ?? ud.heroPlanet),
                    galaxy: effOpacity(ud.galaxy),
                    bridge: effOpacity(ud.auroraBridge?.children?.[0] ?? ud.auroraBridge),
                    bridgeVisible: ud.auroraBridge ? ud.auroraBridge.visible : null,
                    planetAurora: planetAurora ? { name: planetAurora.name, eff: effOpacity(planetAurora), reveal: uni(planetAurora, 'uReveal') } : null,
                    starsNear: effOpacity(ud.starsNear),
                    voidSky: ud.voidSky ? ud.voidSky.visible : null,
                    fieldReveal: ud.nebulaField?.userData?.uReveal?.value ?? null,
                });
            });
            return { boardController: true, rows: out };
        })();
    `, true).catch((e) => ({ probeError: e?.message }));

    console.log('ASCENT SWEEP', JSON.stringify(rows, null, 1));
    if (lines.length) {
        console.log('CONSOLE (warn/error, last 20):');
        lines.slice(-20).forEach((l) => console.log('   ', l));
    }
    win.destroy();
    if (devServer) {
        try {
            spawn('taskkill', ['/pid', String(devServer.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch { /* ignore */ }
    }
    app.quit();
}

main().catch((e) => { console.error('PROBE FAILED', e); app.quit(); });
