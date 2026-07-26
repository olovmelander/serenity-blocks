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
// OD-01 committed-baseline mode: produce the README's four save-state cells
// (cold/warm x fresh/late) with --runs 5 into the COMMITTED reports/odyssey-perf/
// instead of the gitignored exploratory sweep. --dry-run prints the plan without
// spawning a dev server or Electron (verifiable headlessly, safe owner preview).
const COMMITTED = !!args.committed;
const DRY = !!args.dryRun;

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
    runs = 0,
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
    if (runs && runs > 1) list.push('--runs', String(runs));
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
    if (args.screenshot) list.push('--screenshot', String(args.screenshot));
    return list;
}

function spawnSession(options) {
    const argvList = sessionArgs(options);
    if (DRY) {
        const rel = options.output ? path.relative(ROOT, options.output) : '(no output)';
        console.log(`[dry-run] would capture → ${rel}`);
        console.log(`          ${process.execPath} ${argvList.join(' ')}`);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, argvList, {
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

function resolveTag() {
    if (!args.tag || args.tag === true) return null;
    return String(args.tag).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

// OD-01 committed baseline: the README's save-state cells (cold/warm x fresh/late),
// --runs 5, written to the COMMITTED reports/odyssey-perf/ with the documented
// naming (baseline-<tag>-<cache>-<save>.json) so perf-budgets.json has a real
// artifact to gate on. The two fresh cells are fully automated; late cells need an
// owner-primed save profile (--late-profile-dir) because a late save only exists
// after playing to a late chapter once.
async function runCommittedBaseline() {
    const tag = resolveTag();
    if (!tag) {
        throw new Error(
            'committed baseline requires --tag <machine-tag> (e.g. --tag rtx5080 or --tag igpu) '
            + 'so cells are named baseline-<tag>-<cache>-<save>.json',
        );
    }
    const runs = Math.max(1, Number(args.runs || 5));
    const scenario = String(args.scenario || 'load');
    const cachesWanted = parseList(args.caches || args.cache || 'cold,warm');
    const lateProfileDir = (args.lateProfileDir && args.lateProfileDir !== true)
        ? path.resolve(String(args.lateProfileDir))
        : null;

    const reportsDir = path.join(ROOT, 'reports', 'odyssey-perf');
    await mkdir(reportsDir, { recursive: true });

    const warmProfile = path.join(ROOT, 'artifacts', 'odyssey', 'perf-profiles', 'warm');
    if (cachesWanted.includes('warm')) {
        await mkdir(warmProfile, { recursive: true });
        await runWarmPrime(warmProfile);
    }

    const cells = [];
    for (const cache of cachesWanted) {
        cells.push({ cache, save: 'fresh' });
        if (lateProfileDir) cells.push({ cache, save: 'late' });
    }

    const outputs = [];
    for (const { cache, save } of cells) {
        const output = path.join(reportsDir, `baseline-${tag}-${cache}-${save}-${scenario}.json`);
        let profileDir;
        let resetProfile;
        if (save === 'late') {
            profileDir = lateProfileDir; // owner-primed profile that HAS a late save
            resetProfile = false; // never reset — that would wipe the save
        } else if (cache === 'warm') {
            profileDir = warmProfile; // primed above (Dawn cache warm, fresh ch1 save)
            resetProfile = false;
        } else {
            profileDir = path.join(ROOT, 'artifacts', 'odyssey', 'perf-profiles', 'committed-cold-fresh');
            resetProfile = true; // cold cache + fresh save
        }
        console.log(`[odyssey-perf] committed cell ${cache}-${save} → ${path.relative(ROOT, output)} (runs ${runs})`);
        if (save === 'late' && cache === 'cold') {
            console.log("[odyssey-perf]   NOTE: a true cold cache for a late save needs the profile's "
                + 'GPUCache/ subdir deleted (keep Local Storage) before this run — see README.');
        }
        await spawnSession({
            cache, scenario, output, profileDir, resetProfile, runs,
        });
        outputs.push({ cache, save, file: path.relative(ROOT, output) });
    }

    const index = {
        createdAt: new Date().toISOString(),
        tag,
        mode: 'committed',
        runs,
        scenario,
        quality: QUALITY,
        targetFrameRate: TARGET_FRAME_RATE,
        caches: cachesWanted,
        lateProfileDir: lateProfileDir ? path.relative(ROOT, lateProfileDir) : null,
        cells: outputs,
    };
    if (!DRY) {
        await writeFile(path.join(reportsDir, `baseline-${tag}-index.json`), JSON.stringify(index, null, 2), 'utf8');
    }
    const reportsRel = path.relative(ROOT, reportsDir);
    console.log(`[odyssey-perf] committed baseline ${DRY ? 'PLAN ' : ''}complete → ${reportsRel} (${outputs.length} cell(s))`);
    if (!lateProfileDir) {
        console.log('[odyssey-perf] late cells skipped. To include cold-late/warm-late: play once to '
            + 'chapter 7-8 in a dedicated profile, then re-run with --late-profile-dir <that-profile>.');
    }
    if (scenario === 'idle' && cachesWanted.includes('cold')) {
        console.log(`[odyssey-perf] next: copy baseline-${tag}-cold-fresh-idle.json `
            + "aggregate.metrics['frame.p95'].median into perf-budgets.json "
            + '→ budgets.frameP95Ms.perSurface.odyssey, then `npm run perf:odyssey:compare -- --fail-on-regression`.');
    } else {
        console.log(`[odyssey-perf] note: the ${scenario} scenario's frame.p95 includes startup/compile `
            + 'hitches (good as a startup diagnostic). Seed the STEADY-STATE frame budget from a '
            + '`--scenario idle` capture instead.');
    }
}

async function main() {
    await mkdir(ARTIFACT_ROOT, { recursive: true });
    if (args.clean) {
        await rm(ARTIFACT_ROOT, { recursive: true, force: true });
        await mkdir(ARTIFACT_ROOT, { recursive: true });
    }

    if (!DRY) {
        devServer = startDevServer();
        await waitForServer(BASE_URL);
    }

    if (COMMITTED) {
        await runCommittedBaseline();
        return;
    }

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
