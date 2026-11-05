import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { stopChildProcess } from '../../scripts/lib/stop-child-process.mjs';

// Exercise only the CLI's cleanup body, without importing Electron or booting a GPU.
function captureCleanup(script, child) {
    const source = readFileSync(new URL(`../../scripts/${script}`, import.meta.url), 'utf8');
    const body = source.match(/async function stopDevServer\(\) \{[\s\S]*?\n\}/)?.[0]
        || `async function stopDevServer() {${source.match(/finally \{\n([\s\S]*?)\n    \}/)[1]}}`;
    const tree = source.match(/function killProcessTree\(proc\) \{[\s\S]*?\n\}/)?.[0] || '';
    return new Function(
        'devServerProcess', 'devServer', 'stopChildProcess', 'delay', 'path', 'writeFile',
        'ARTIFACT_DIR', 'app', 'code', `${tree}\n${body}\nreturn stopDevServer();`,
    )(
        child, child, stopChildProcess, delay, path, async () => {}, '/unused-artifacts', { exit() {} }, 0,
    );
}

async function withChild(onSignal, run) {
    const child = spawn(process.execPath, ['-e', `
        ${onSignal}
        setInterval(() => {}, 1000);
        process.send('ready');
    `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = once(child, 'exit');
    try {
        await once(child, 'message');
        await run(child, exited);
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
    }
}

async function expectExited(exited, signal) {
    let timer;
    try {
        const result = await Promise.race([
            exited,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Child survived cleanup')), 1500);
            }),
        ]);
        expect(result).toEqual([null, signal]);
    } finally {
        clearTimeout(timer);
    }
}

describe('capture child-process cleanup', () => {
    it.each([
        null,
        { pid: undefined, exitCode: null, signalCode: null },
        { pid: 123, exitCode: 0, signalCode: null },
        { pid: 123, exitCode: null, signalCode: 'SIGTERM' },
    ])('does not signal an absent or already exited child (%j)', async (state) => {
        const child = state && { ...state, kill: vi.fn() };
        await stopChildProcess(child, 1);
        if (child) expect(child.kill).not.toHaveBeenCalled();
    });

    it('does not escalate after a normal child exits', async () => {
        await withChild('', async (child, exited) => {
            const kill = vi.spyOn(child, 'kill');
            await stopChildProcess(child, 100);
            await expectExited(exited, 'SIGTERM');
            expect(kill.mock.calls).toEqual([['SIGTERM']]);
        });
    });

    it.skipIf(process.platform === 'win32')('escalates even when SIGTERM was already sent', async () => {
        await withChild("process.on('SIGTERM', () => {});", async (child, exited) => {
            child.kill('SIGTERM');
            expect(child.killed).toBe(true);
            await stopChildProcess(child, 30);
            await expectExited(exited, 'SIGKILL');
        });
    });

    it.skipIf(process.platform === 'win32').each([
        'odyssey-aaa-board-capture.mjs',
        'odyssey-chapter-capture.mjs',
        'odyssey-webgpu-validation.mjs',
        'odyssey-perf-baseline.mjs',
        'odyssey-portal-transition-validation.mjs',
        'test-phase-e-resilience.mjs',
        'wolfhour-phase0-validation.mjs',
        'wolfhour-phase6-validation.mjs',
    ])('%s escalates a child that ignores SIGTERM', async (script) => {
        await withChild("process.on('SIGTERM', () => {});", async (child, exited) => {
            await captureCleanup(script, child);
            await expectExited(exited, 'SIGKILL');
        });
    });
});
