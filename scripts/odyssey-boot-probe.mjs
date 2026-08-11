/**
 * ODYSSEY BOOT PROBE — dump board state regardless of readiness.
 *
 * scripts/odyssey-chapter-capture.mjs only writes its console log at the END of a SUCCESSFUL
 * run, so any boot problem there produces a timeout and nothing else: no console, no state, no
 * clue. This loads the board, waits a fixed interval, and dumps whatever exists — which is the
 * difference between "it hangs" and knowing which object is missing.
 *
 * Usage:
 *   PROBE_PORT=5173 PROBE_WAIT=40000 PROBE_FLAGS=odysseyOneWorld=1  *     node scripts/run-electron.mjs scripts/odyssey-boot-probe.mjs
 */
/* eslint-disable import/no-extraneous-dependencies, no-console */
import electron from 'electron';

const { app, BrowserWindow } = electron;
const PORT = process.env.PROBE_PORT || '5173';
const WAIT_MS = Number.parseInt(process.env.PROBE_WAIT || '45000', 10);
const lines = [];

app.commandLine.appendSwitch('force_high_performance_gpu');
app.disableHardwareAcceleration = () => {};

async function main() {
    await app.whenReady();
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        show: true,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    win.webContents.on('console-message', (_e, level, message, line, source) => {
        lines.push(`[${level}] ${source}:${line} ${message}`);
    });

    const params = new URLSearchParams({
        skipIntro: '1',
        odysseyAAA: '1',
        odysseyOverlay: '0',
        odysseyPixelRatio: '1',
        odysseyDisableAdaptiveQuality: '1',
        odysseyDisableBackgroundLoading: '1',
        probeBust: String(Date.now()),
    });
    String(process.env.PROBE_FLAGS || '').split(',').filter(Boolean).forEach((pair) => {
        const [k, v = '1'] = pair.split('=');
        if (k) params.set(k, v);
    });
    const url = `http://127.0.0.1:${PORT}/?${params.toString()}`;
    console.log('PROBE loading', url);
    await win.loadURL(url);

    await win.webContents.executeJavaScript(`
        (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            for (let i = 0; i < 60; i += 1) {
                if (window.serenityBlocks?.gameModeManager) break;
                await sleep(200);
            }
            const gm = window.serenityBlocks?.gameModeManager;
            if (gm && gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (gm && !gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            return true;
        })();
    `, true).catch((e) => console.log('PROBE activate threw:', e?.message));

    await new Promise((resolve) => { setTimeout(resolve, WAIT_MS); });

    const state = await win.webContents.executeJavaScript(`
        (() => {
            const bc = window.odysseyMode?.boardController;
            if (!bc) return { boardController: false };
            return {
                boardController: true,
                isActive: !!bc.isActive,
                oneWorldEnabled: !!bc.oneWorldEnabled,
                hasOneWorld: !!bc.oneWorld,
                oneWorldStats: bc.oneWorld?.stats || null,
                hasCamera: !!bc.cameraController,
                hasEnvManager: !!bc.environmentManager,
                suppressed: bc.environmentManager
                    ? [...(bc.environmentManager.suppressedChapters || [])] : null,
                environments: bc.environmentManager
                    ? [...(bc.environmentManager.environments?.keys?.() || [])].sort() : null,
                pendingChapterLoads: bc.pendingChapterLoads?.size ?? null,
                sceneChildren: bc.scene?.children?.length ?? null,
                worldChildren: (() => {
                    const g = (bc.scene?.children || []).find((c) => c.name === 'odyssey-act2-world');
                    if (!g) return null;
                    return g.children.slice(0, 6).map((c) => ({
                        name: c.name,
                        visible: c.visible,
                        renderOrder: c.renderOrder,
                        frustumCulled: c.frustumCulled,
                        matVisible: c.material ? c.material.visible : null,
                        geoRadius: c.geometry?.boundingSphere?.radius ?? null,
                    }));
                })(),
                groupVisible: (bc.scene?.children || []).find(
                    (c) => c.name === 'odyssey-act2-world',
                )?.visible ?? null,
                atmosphereDomeVisible: bc.atmosphere?.dome?.visible ?? null,
                cameraFar: bc.camera?.far ?? null,
                cameraNear: bc.camera?.near ?? null,
                worldInScene: !!(bc.scene?.children || []).find(
                    (c) => c.name === 'odyssey-act2-world',
                ),
            };
        })();
    `, true).catch((e) => ({ probeError: e?.message }));

    console.log('PROBE STATE', JSON.stringify(state, null, 2));
    console.log('PROBE CONSOLE (last 60):');
    lines.slice(-60).forEach((l) => console.log('   ', l));
    win.destroy();
    app.quit();
}

main().catch((e) => { console.error('PROBE FAILED', e); app.quit(); });
