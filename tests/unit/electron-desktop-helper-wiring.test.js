import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tripwire: electron/main.js must stay wired to the tested desktop helper
// modules (gpu-health, devtools-policy, devtools-shortcuts). These helpers
// were once de-wired in favor of inline stubs, which silently broke the
// settings-UI "Open DevTools" button (it requires { accepted, requestId })
// and shipped a gpu-health status vocabulary ('ok') the renderer's
// healthy/degraded/unsafe body classes never matched. This test reads
// main.js as source text — same pattern as electron-background-throttling —
// so a regression fails CI even though the Electron main process itself
// never runs under vitest.

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(join(__dirname, '../../electron/main.js'), 'utf8');
const steamSource = readFileSync(join(__dirname, '../../electron/steam-integration.js'), 'utf8');
const preloadSource = readFileSync(join(__dirname, '../../electron/preload.cjs'), 'utf8');
const preloadMjsSource = readFileSync(join(__dirname, '../../electron/preload.mjs'), 'utf8');

describe('electron/main.js desktop helper wiring', () => {
    it('imports the tested helper modules', () => {
        expect(mainSource).toContain("from './gpu-health.js'");
        expect(mainSource).toContain("from './devtools-policy.js'");
        expect(mainSource).toContain("from './devtools-shortcuts.js'");
    });

    it('classifies GPU health instead of stubbing it', () => {
        // Anchor the classifier to the IPC handler, not just to the file:
        // the handler must delegate to getGpuHealthSnapshot, and the snapshot
        // must call classifyGpuHealth.
        expect(mainSource).toMatch(/'desktop:get-gpu-health',\s*\(\)\s*=>\s*getGpuHealthSnapshot\(\)/);
        expect(mainSource).toMatch(/function getGpuHealthSnapshot\(\)[\s\S]*?classifyGpuHealth\(\{/);
        // The old stub/override vocabulary must not return: the renderer
        // toggles body classes only for healthy/degraded/unsafe.
        expect(mainSource).not.toMatch(/get-gpu-health'[\s\S]{0,200}status: 'ok'/);
    });

    it('answers DevTools open requests with the accepted/requestId contract', () => {
        expect(mainSource).toContain('decideDevToolsOpenRequest({');
        expect(mainSource).toContain('getDevToolsOpenStrategy({');
        expect(mainSource).toMatch(/'desktop:open-devtools',\s*\(\)\s*=>\s*requestDevToolsOpen\(/);
        expect(mainSource).toMatch(/'desktop:open-renderer-debugger',\s*\(\)\s*=>\s*requestDevToolsOpen\(/);
        expect(mainSource).toContain("emitRuntimeEvent('devtools-opened'");
        expect(mainSource).toContain("emitRuntimeEvent('devtools-open-failed'");
    });

    it('routes keyboard shortcuts through the dedup helpers', () => {
        expect(mainSource).toContain("on('before-input-event'");
        expect(mainSource).toContain('getDevToolsShortcutIntent(input)');
        expect(mainSource).toContain('isDuplicateDevToolsShortcut(devToolsShortcutState, intent)');
    });

    it('keeps the debug keys and menu out of release builds (audit T14)', () => {
        expect(mainSource).toContain('const debugKeys = debugKeysEnabled({ isPackaged, diagnosticsEnabled });');
        expect(mainSource).toMatch(/if \(debugKeys\) \{\s*mainWindow\.webContents\.on\('before-input-event'/);
        expect(mainSource).toMatch(/Menu\.setApplicationMenu\(debugKeys \? Menu\.buildFromTemplate\(/);
    });

    it('refuses to send a P2P packet bigger than receivers accept (audit NET-08)', () => {
        expect(steamSource).toMatch(/const buffer = encodeP2PPacketBody\(data\);\s*\/\/[^\n]*\n[^\n]*\n\s*if \(buffer\.byteLength > MAX_P2P_PACKET_BYTES\) \{[\s\S]{0,200}?return \{ sent: false/);
        expect(steamSource).toMatch(/if \(size > MAX_P2P_PACKET_BYTES\) \{/);
    });

    it('opens no window in a second instance, which only hands focus over and quits', () => {
        expect(mainSource).toMatch(/const gotLock = app\.requestSingleInstanceLock\(\);\s*if \(!gotLock\) \{\s*app\.quit\(\);/);
        expect(mainSource).toMatch(/app\.whenReady\(\)\.then\(\(\) => \{\s*if \(!gotLock\) return;\s*installContentSecurityPolicy\(\);\s*createWindow\(\);/);
        expect(mainSource).toMatch(/app\.on\('activate', \(\) => \{\s*if \(gotLock && BrowserWindow\.getAllWindows\(\)\.length === 0\)/);
    });

    it('hands only allowlisted links to the system browser (audit T14)', () => {
        expect(mainSource).toContain("from './external-links.js'");
        expect(mainSource).toMatch(
            /function openExternalIfAllowed\(targetUrl\) \{\s*if \(!isAllowedExternalUrl\(targetUrl\)\)/,
        );
        expect(mainSource.match(/shell\.openExternal\(/g)).toHaveLength(1);
    });

    it('loads a Steam module override only in unpackaged runs (audit T14)', () => {
        expect(steamSource).toContain('const override = app.isPackaged ? null : process.env.STEAMWORKS_MODULE;');
    });

    it('recovers from a renderer crash, hang or load failure instead of a black window (audit ELEC-09)', () => {
        expect(mainSource).toContain("from './renderer-recovery.js'");
        expect(mainSource).toMatch(
            /webContents\.on\('render-process-gone',[\s\S]{0,400}?decideRendererRecovery\(\{/,
        );
        expect(mainSource).toMatch(/mainWindow\.on\('unresponsive',[\s\S]{0,1200}?forcefullyCrashRenderer\(\)/);
        expect(mainSource).toMatch(/webContents\.on\('did-fail-load',[\s\S]{0,300}?isFatalLoadFailure\(\{/);
        // A failed startup reports itself instead of leaving a windowless process behind.
        expect(mainSource).toMatch(/\}\)\.catch\(\(error\) => \{[\s\S]{0,200}?dialog\.showErrorBox\(/);
        // Crash dumps stay on the machine: started before ready, never uploaded.
        expect(mainSource).toMatch(/\ncrashReporter\.start\(\{ uploadToServer: false \}\);\n[\s\S]*app\.whenReady\(\)/);
    });

    it('lets the game finish its saves before the window closes (audit LIFE-14)', () => {
        expect(mainSource).toContain("from './quit-flush.js'");
        expect(mainSource).toMatch(
            /mainWindow\.on\('close', \(event\) => \{[\s\S]{0,300}?event\.preventDefault\(\);[\s\S]{0,200}?requestRendererQuitFlush\(\{/,
        );
        // Both preloads: preload.cjs ships, preload.mjs runs under the validate:windows:* harnesses.
        [preloadSource, preloadMjsSource].forEach((source) => {
            expect(source).toMatch(
                /ipcRenderer\.on\('desktop:prepare-quit'[\s\S]{0,200}?ipcRenderer\.send\('desktop:quit-ready', requestId\)/,
            );
            expect(source).toContain('onPrepareQuit: (prepare) =>');
        });
    });
});
