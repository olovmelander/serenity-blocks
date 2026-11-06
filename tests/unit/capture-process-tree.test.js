import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
    chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import * as processes from '../../scripts/lib/stop-child-process.mjs';

// The fallback lets the same reproductions run against the previous direct-child helper.
const ownedSpawn = processes.spawnOwnedProcess || spawn;

async function freePort() {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function responseAt(port) {
    try {
        return await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(250) })).json();
    } catch {
        return null;
    }
}

async function listening(port) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const result = await responseAt(port);
        if (result) return result;
        await delay(30);
    }
    throw new Error('Owned server fixture did not start');
}

async function expectPortClosed(port) {
    const canBind = () => new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', (error) => {
            if (error.code === 'EADDRINUSE') resolve(false);
            else reject(error);
        });
        probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    for (let attempt = 0; attempt < 30; attempt++) {
        if (await canBind()) return;
        await delay(10);
    }
    expect(await canBind(), 'Owned descendant kept its port after cleanup').toBe(true);
}

function startFromScript(source, root, port) {
    const body = source.match(/function startDevServer\(\) \{[\s\S]*?\n\}/)[0];
    return new Function('spawn', 'spawnOwnedProcess', 'ROOT', 'PORT', 'DEV_SERVER_PORT', 'args', 'consoleLines',
        `${body}\nreturn startDevServer();`)(spawn, ownedSpawn, root, port, port, { verbose: false }, []);
}

function stopFromScript(source, child) {
    const body = source.match(/async function stopDevServer\(\) \{[\s\S]*?\n\}/)?.[0]
        || `async function stopDevServer() {${source.match(/finally \{\n([\s\S]*?)\n    \}/)[1]}}`;
    const tree = source.match(/function killProcessTree\(proc\) \{[\s\S]*?\n\}/)?.[0] || '';
    return new Function('devServerProcess', 'devServer', 'stopChildProcess', 'delay', 'path', 'writeFile',
        'ARTIFACT_DIR', 'app', 'code', `${tree}\n${body}\nreturn stopDevServer();`)(
        child, child, processes.stopChildProcess, delay, path, async () => {}, '/unused-artifacts', { exit() {} }, 0,
    );
}

async function withServerFixture(run, { ignoreTerm = false } = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'serenity capture tree '));
    const port = await freePort();
    const children = [];
    try {
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { dev: 'node server.mjs' } }));
        await writeFile(path.join(root, 'server.mjs'), `#!/usr/bin/env node
import { createServer } from 'node:http';
${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
createServer((req, res) => res.end(JSON.stringify({ pid: process.pid, fixture: ${JSON.stringify(root)} }))).listen(port, '127.0.0.1');
`);
        await chmod(path.join(root, 'server.mjs'), 0o755);
        await mkdir(path.join(root, 'node_modules', '.bin'), { recursive: true });
        await symlink(path.join(root, 'server.mjs'), path.join(root, 'node_modules', '.bin', 'vite'));
        // The npx caller resolves this fixture's executable; it must never download a package.
        await writeFile(path.join(root, '.npmrc'), 'offline=true\nyes=false\n');
        await run({ root, port, children });
    } finally {
        // Pre-fix reproductions deliberately leave the server alive. Reap only the PID
        // returned by our isolated fixture, never a process/port discovered elsewhere.
        const server = await responseAt(port);
        if (server?.pid && server.fixture === root) {
            try { process.kill(server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        for (const child of children) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
        }
        await rm(root, { recursive: true, force: true });
    }
}

describe.skipIf(process.platform === 'win32')('owned POSIX capture process groups', () => {
    it.each([
        'odyssey-aaa-board-capture.mjs',
        'odyssey-chapter-capture.mjs',
        'odyssey-gpu-split.mjs',
        'odyssey-webgpu-validation.mjs',
        'odyssey-perf-baseline.mjs',
        'odyssey-portal-transition-validation.mjs',
        'test-phase-e-resilience.mjs',
        'wolfhour-phase0-validation.mjs',
        'wolfhour-phase6-validation.mjs',
    ])('%s releases the server port behind its command wrapper', async (script) => {
        await withServerFixture(async ({ root, port, children }) => {
            const source = await readFile(new URL(`../../scripts/${script}`, import.meta.url), 'utf8');
            const child = startFromScript(source, root, port);
            children.push(child);
            child.stdout?.resume();
            child.stderr?.resume();
            const server = await listening(port);
            expect(server.fixture).toBe(root);
            expect(server.pid).not.toBe(child.pid);
            await stopFromScript(source, child);
            await expectPortClosed(port);
        });
    });

    it('stops remaining descendants after the owned wrapper has already exited', async () => {
        await withServerFixture(async ({ root, port, children }) => {
            const child = ownedSpawn(process.execPath, ['-e', `
const { spawn } = require('node:child_process');
const server = spawn(process.execPath, ['server.mjs', '--port', '${port}'], { stdio: 'ignore' });
server.unref();
`], { cwd: root, stdio: 'ignore' });
            children.push(child);
            await once(child, 'exit');
            await listening(port);
            await processes.stopChildProcess(child, 30);
            await expectPortClosed(port);
        });
    });

    it('escalates the group after SIGTERM was already sent to its wrapper', async () => {
        await withServerFixture(async ({ root, port, children }) => {
            const child = ownedSpawn(process.execPath, ['-e', `
process.on('SIGTERM', () => {});
require('node:child_process').spawn(process.execPath, ['server.mjs', '--port', '${port}'], { stdio: 'ignore' });
`], { cwd: root, stdio: 'ignore' });
            children.push(child);
            await listening(port);
            child.kill('SIGTERM');
            expect(child.killed).toBe(true);
            await processes.stopChildProcess(child, 30);
            await expectPortClosed(port);
        }, { ignoreTerm: true });
    });

    it('keeps group signaling scoped to an owned live group and is idempotent', async () => {
        const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
        const calls = vi.spyOn(process, 'kill');
        try {
            await withServerFixture(async ({ root, port, children }) => {
                const child = ownedSpawn(process.execPath, ['server.mjs', '--port', String(port)], { cwd: root, stdio: 'ignore' });
                children.push(child);
                await listening(port);
                await processes.stopChildProcess(child, 30);
                await expectPortClosed(port);
                const signalCount = calls.mock.calls.length;
                await processes.stopChildProcess(child, 30);
                expect(calls.mock.calls.length).toBe(signalCount);
                expect(calls.mock.calls.every(([pid]) => pid === -child.pid)).toBe(true);
                expect(unrelated.exitCode).toBeNull();
                expect(unrelated.signalCode).toBeNull();
            });
        } finally {
            calls.mockRestore();
            unrelated.kill('SIGKILL');
            await once(unrelated, 'exit');
        }
    });
});

// `detached` puts an owned group in its own session, out of reach of the terminal's
// Ctrl+C and hang-up. The harness must forward those (and a plain exit) itself.
async function startHarness(root, port, { ownHandler = false, exitAfterReady = false, copies = 1 } = {}) {
    const helper = new URL('../../scripts/lib/stop-child-process.mjs', import.meta.url).href;
    // A query string loads a second, separate instance of the same module.
    const copyUrls = Array.from({ length: copies }, (_, index) => `${helper}?copy=${index}`);
    await writeFile(path.join(root, 'harness.mjs'), `
const spawners = [];
for (const url of ${JSON.stringify(copyUrls)}) spawners.push((await import(url)).spawnOwnedProcess);
const [spawnOwnedProcess, ...otherCopies] = spawners;
${ownHandler ? "process.on('SIGINT', () => process.stdout.write('handled\\n'));" : ''}
for (const spawnIdle of otherCopies) spawnIdle(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const server = spawnOwnedProcess(process.execPath, ['server.mjs', '--port', '${port}'], { stdio: 'ignore' });
setInterval(() => {}, 1000);
process.stdout.write('spawned ' + server.pid + '\\n');
${exitAfterReady ? "process.stdin.once('data', () => process.exit(0));" : ''}
`);
    // Its own group stands in for the terminal's foreground job.
    const harness = spawn(process.execPath, ['harness.mjs'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], detached: true });
    const output = [];
    harness.stdout.on('data', (chunk) => output.push(String(chunk)));
    await listening(port);
    return { harness, output };
}

describe.skipIf(process.platform === 'win32')('owned groups follow their harness', () => {
    it.each([
        ['Ctrl+C', 'SIGINT', true],
        ['a closed terminal', 'SIGHUP', true],
        ['a direct termination', 'SIGTERM', false],
    ])('%s stops the server and still ends the harness by %s', async (_name, signal, toJob) => {
        await withServerFixture(async ({ root, port, children }) => {
            const { harness } = await startHarness(root, port);
            children.push(harness);
            const exited = once(harness, 'exit');
            process.kill(toJob ? -harness.pid : harness.pid, signal);
            const [code, endedBy] = await exited;
            expect(code).toBeNull();
            expect(endedBy).toBe(signal);
            await expectPortClosed(port);
        });
    });

    it('still ends by Ctrl+C when two copies of the helper are loaded', async () => {
        await withServerFixture(async ({ root, port, children }) => {
            const { harness } = await startHarness(root, port, { copies: 2 });
            children.push(harness);
            const exited = once(harness, 'exit');
            process.kill(-harness.pid, 'SIGINT');
            const [code, endedBy] = await Promise.race([exited, delay(3000).then(() => ['still running', null])]);
            expect(code).toBeNull();
            expect(endedBy).toBe('SIGINT');
            await expectPortClosed(port);
        });
    });

    it('treats a group it may no longer signal as already stopped', async () => {
        const child = processes.spawnOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        const realKill = process.kill.bind(process);
        const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
            if (pid === -child.pid) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
            return realKill(pid, signal);
        });
        try {
            await expect(processes.stopChildProcess(child, 30)).resolves.toBeUndefined();
        } finally {
            kill.mockRestore();
            realKill(-child.pid, 'SIGKILL');
            if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
        }
    });

    it('stops the server when the harness exits without cleaning up', async () => {
        await withServerFixture(async ({ root, port, children }) => {
            const { harness } = await startHarness(root, port, { exitAfterReady: true });
            children.push(harness);
            const exited = once(harness, 'exit');
            harness.stdin.write('go\n');
            expect((await exited)[0]).toBe(0);
            await expectPortClosed(port);
        });
    });

    it('leaves a harness that handles Ctrl+C itself running', async () => {
        await withServerFixture(async ({ root, port, children }) => {
            const { harness, output } = await startHarness(root, port, { ownHandler: true });
            children.push(harness);
            process.kill(-harness.pid, 'SIGINT');
            await expectPortClosed(port);
            for (let attempt = 0; attempt < 50 && !output.join('').includes('handled'); attempt++) await delay(10);
            expect(output.join('')).toContain('handled');
            expect(harness.exitCode).toBeNull();
            expect(harness.signalCode).toBeNull();
        });
    });
});
