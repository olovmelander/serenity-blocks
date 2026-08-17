/**
 * CH6 VISIBILITY PROBE — why does chapter 6 render an empty frame in-game?
 *
 * The 2026-08-16 ground-truth capture showed chapter 6 rendering a flat void
 * (mean luma 11.6, byte-identical) from local progress 0.263 to 1.000, while a
 * headless replay of the SAME staging maths (real camera, real spline) reported the
 * dome visible, the nebula field revealed and the heroes at full opacity. So the
 * defect is at the board/manager layer, not in the chapter's own logic. This seeks
 * the real board to a dead station and dumps what is actually in the scene.
 *
 * Usage:
 *   PROBE_PORT=4177 node scripts/run-electron.mjs scripts/odyssey-ch6-visibility-probe.mjs
 */
/* eslint-disable import/no-extraneous-dependencies, no-console */
import electron from 'electron';
import { spawn } from 'child_process';

const { app, BrowserWindow } = electron;
const PORT = process.env.PROBE_PORT || '4177';
const SEEK = Number.parseFloat(process.env.PROBE_SEEK || '0.71');
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

    const state = await win.webContents.executeJavaScript(`
        (() => {
            const bc = window.odysseyMode?.boardController;
            if (!bc) return { boardController: false };
            const pos = ${SEEK};
            // Drive exactly like the capture harness does.
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
            const describe = (o) => (o ? {
                name: o.name,
                visible: o.visible,
                parentVisible: o.parent ? o.parent.visible : null,
                opacity: o.material ? o.material.opacity : null,
                transparent: o.material ? o.material.transparent : null,
            } : null);

            const inScene = [];
            bc.scene.traverse((o) => { if (o.name && o.name.includes('cosmic')) inScene.push(o.name); });

            return {
                boardController: true,
                blendState,
                envKeys: [...bc.environmentManager.environments.keys()],
                envIsGroup: !!(group && group.isObject3D),
                groupName: group?.name ?? null,
                groupVisible: group?.visible ?? null,
                groupInScene: group ? !!group.parent : null,
                groupParent: group?.parent?.name ?? null,
                chapterOpacity: group?.userData?.chapterOpacity ?? null,
                groupPos: group ? group.position.toArray().map((v) => Math.round(v)) : null,
                camPos: bc.camera.position.toArray().map((v) => Math.round(v)),
                camFar: bc.camera.far,
                distToGroup: group ? Math.round(bc.camera.position.distanceTo(group.position)) : null,
                voidSky: describe(group?.userData?.voidSky),
                nebulaField: describe(group?.userData?.nebulaField),
                fieldReveal: group?.userData?.nebulaField?.userData?.uReveal?.value ?? null,
                heroPlanet: describe(group?.userData?.heroPlanet),
                blackHole: describe(group?.userData?.blackHole),
                starsNear: describe(group?.userData?.starsNear),
                entryState: group?.userData?.entryContinuityState ?? null,
                staging: group?.userData?.summitEarthStaging ?? null,
                cosmicNamesInScene: inScene.slice(0, 12),
                render: {
                    drawCalls: bc.renderer?.info?.render?.drawCalls ?? null,
                    triangles: bc.renderer?.info?.render?.triangles ?? null,
                },
            };
        })();
    `, true).catch((e) => ({ probeError: e?.message }));

    console.log('CH6 PROBE', JSON.stringify(state, null, 2));
    if (lines.length) {
        console.log('CONSOLE (warn/error, last 25):');
        lines.slice(-25).forEach((l) => console.log('   ', l));
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
