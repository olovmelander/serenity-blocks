#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { spawn } from 'child_process';
import {
    mkdir, rm, writeFile,
} from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || process.env.ODYSSEY_PERF_PORT || 4177);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_ROOT = path.resolve(String(args.outDir || path.join(
    ROOT,
    'artifacts',
    'odyssey',
    'perf',
    new Date().toISOString().replace(/[:.]/g, '-'),
)));
const QUALITY = String(args.quality || process.env.ODYSSEY_PERF_QUALITY || 'Extreme');
const TARGET_FRAME_RATE = Number(args.targetFrameRate || process.env.ODYSSEY_PERF_TARGET_FPS || 240);
const WARMUP_MODE = String(args.warmupMode || process.env.ODYSSEY_PERF_WARMUP_MODE || 'current');
const DURATION_MS = Number(args.duration || process.env.ODYSSEY_PERF_DURATION_MS || 30000);
const PAN_DURATION_MS = Number(args.panDuration || process.env.ODYSSEY_PERF_PAN_MS || 2200);
const WIDTH = Number(args.width || process.env.ODYSSEY_PERF_WIDTH || 1280);
const HEIGHT = Number(args.height || process.env.ODYSSEY_PERF_HEIGHT || 720);
const caches = parseList(args.caches || args.cache || process.env.ODYSSEY_PERF_CACHES || 'cold,warm,degraded');
const scenarios = parseList(args.scenarios || args.scenario || process.env.ODYSSEY_PERF_SCENARIOS || 'load,idle,scroll,transition');
const degradedCycles = Number(args.reloadCycles || process.env.ODYSSEY_PERF_RELOAD_CYCLES || 4);

let devServer = null;

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const raw = token.slice(2);
        const [key, inline] = raw.split('=', 2);
        const normalized = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (inline !== undefined) {
            out[normalized] = inline;
        } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
            out[normalized] = argv[i + 1];
            i += 1;
        } else {
            out[normalized] = true;
        }
    }
    return out;
}

function parseList(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // Keep polling.
        }
        await delay(350);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function startDevServer() {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const commandArgs = isWindows
        ? [
            '/d', '/s', '/c',
            'npm.cmd', 'run', 'dev', '--',
            '--host', '127.0.0.1',
            '--port', String(PORT),
            '--strictPort',
        ]
        : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'];

    const proc = spawn(command, commandArgs, {
        cwd: ROOT,
        stdio: args.verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
    });

    if (!args.verbose) {
        proc.stdout.on('data', () => {});
        proc.stderr.on('data', () => {});
    }
    return proc;
}

async function stopDevServer() {
    if (!devServer) return;
    const proc = devServer;
    devServer = null;
    if (!proc.killed) {
        if (process.platform === 'win32') {
            await new Promise((resolve) => {
                const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
                    stdio: args.verbose ? 'inherit' : 'ignore',
                });
                killer.on('exit', resolve);
                killer.on('error', resolve);
            });
            return;
        }
        proc.kill('SIGTERM');
        await delay(800);
        if (!proc.killed) proc.kill('SIGKILL');
    }
}

function sessionArgs({
    cache,
    scenario,
    output,
    profileDir,
    reloadCycles = 0,
    resetProfile = false,
    duration = DURATION_MS,
}) {
    const list = [
        'scripts/run-electron.mjs',
        'scripts/odyssey-perf-session.mjs',
        '--port', String(PORT),
        '--scenario', scenario,
        '--cache', cache,
        '--quality', QUALITY,
        '--target-frame-rate', String(TARGET_FRAME_RATE),
        '--warmup-mode', WARMUP_MODE,
        '--duration', String(duration),
        '--pan-duration', String(PAN_DURATION_MS),
        '--width', String(WIDTH),
        '--height', String(HEIGHT),
        '--profile-dir', profileDir,
        '--output', output,
        '--reload-cycles', String(reloadCycles),
    ];
    if (resetProfile) list.push('--reset-profile');
    if (args.hide) list.push('--hide');
    if (args.verbose) list.push('--verbose');
    if (args.forceWebgl || args.forceWebGL) list.push('--force-webgl');
    if (args.disableBackgroundWarm) list.push('--disable-background-warm');
    if (args.disableBackgroundLoading) list.push('--disable-background-loading');
    if (args.disableAdaptiveQuality) list.push('--disable-adaptive-quality');
    if (args.disableBloom) list.push('--disable-bloom');
    if (args.bloomScale) list.push('--bloom-scale', String(args.bloomScale));
    if (args.postQuality) list.push('--post-quality', String(args.postQuality));
    if (args.idlePosition) list.push('--idle-position', String(args.idlePosition));
    if (args.gpuSync) list.push('--gpu-sync');
    if (args.pixelRatio) list.push('--pixel-ratio', String(args.pixelRatio));
    if (args.warpPreinit) list.push('--warp-preinit', String(args.warpPreinit));
    return list;
}

function spawnSession(options) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, sessionArgs(options), {
            cwd: ROOT,
            stdio: 'inherit',
            env: {
                ...process.env,
                ODYSSEY_PERF_BASE_URL: BASE_URL,
                ODYSSEY_PERF_PORT: String(PORT),
            },
        });
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Session killed by ${signal}`));
                return;
            }
            if (code !== 0) {
                reject(new Error(`Session exited with code ${code}`));
                return;
            }
            resolve();
        });
        child.on('error', reject);
    });
}

async function runWarmPrime(profileDir) {
    const output = path.join(ARTIFACT_ROOT, 'warm-prime.json');
    console.log('[odyssey-perf] priming warm cache profile...');
    await spawnSession({
        cache: 'warm-prime',
        scenario: 'load',
        output,
        profileDir,
        reloadCycles: 0,
        resetProfile: args.resetWarmProfile,
        duration: 1500,
    });
}

async function main() {
    await mkdir(ARTIFACT_ROOT, { recursive: true });
    if (args.clean) {
        await rm(ARTIFACT_ROOT, { recursive: true, force: true });
        await mkdir(ARTIFACT_ROOT, { recursive: true });
    }

    devServer = startDevServer();
    await waitForServer(BASE_URL);

    const outputs = [];
    const warmProfile = path.join(ROOT, 'artifacts', 'odyssey', 'perf-profiles', 'warm');
    if (caches.includes('warm')) {
        await mkdir(warmProfile, { recursive: true });
        await runWarmPrime(warmProfile);
    }

    for (const cache of caches) {
        for (const scenario of scenarios) {
            const profileDir = cache === 'warm'
                ? warmProfile
                : path.join(ARTIFACT_ROOT, 'profiles', `${cache}-${scenario}`);
            const output = path.join(ARTIFACT_ROOT, `${cache}-${scenario}.json`);
            const reloadCycles = cache === 'degraded' ? degradedCycles : 0;
            const resetProfile = cache !== 'warm';
            console.log(`[odyssey-perf] running ${cache}/${scenario}...`);
            await spawnSession({
                cache,
                scenario,
                output,
                profileDir,
                reloadCycles,
                resetProfile,
            });
            outputs.push({
                cache,
                scenario,
                file: path.relative(ROOT, output),
            });
        }
    }

    const manifest = {
        createdAt: new Date().toISOString(),
        quality: QUALITY,
        targetFrameRate: TARGET_FRAME_RATE,
        warmupMode: WARMUP_MODE,
        durationMs: DURATION_MS,
        panDurationMs: PAN_DURATION_MS,
        caches,
        scenarios,
        outputs,
    };
    const manifestFile = path.join(ARTIFACT_ROOT, 'manifest.json');
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`[odyssey-perf] manifest: ${path.relative(ROOT, manifestFile)}`);
}

main()
    .catch((error) => {
        console.error('[odyssey-perf] baseline failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await stopDevServer();
    });
