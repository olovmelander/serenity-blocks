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
});
