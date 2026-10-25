import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packIco } from './app-icon/ico.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');
const iconOutputPath = path.join(buildDir, 'icon.ico');
// The app mark at every Windows size (scripts/generate-app-icon.mjs, docs/desktop-icons.md).
const defaultIconSource = path.join(projectRoot, 'public', 'assets', 'branding', 'serenity-blocks.ico');
const iconSourcePath = process.env.SERENITY_WINDOWS_ICON_SOURCE
    ? path.resolve(projectRoot, process.env.SERENITY_WINDOWS_ICON_SOURCE)
    : defaultIconSource;
const allowNonWindowsBuild = process.platform === 'win32' || process.env.SERENITY_ALLOW_WSL_WIN_BUILD === '1';
const isUnsupportedWslFallback = process.platform !== 'win32' && process.env.SERENITY_ALLOW_WSL_WIN_BUILD === '1';

// Code signing: To enable Windows code signing, set these environment variables:
//   CSC_LINK=path/to/certificate.pfx
//   CSC_KEY_PASSWORD=your_certificate_password
// electron-builder will automatically pick them up during the packaging step.

function runCommand(command, args) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: process.env,
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function runCommandAsync(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            stdio: 'inherit',
            shell: process.platform === 'win32',
            env: process.env,
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}

function ensureWindowsIcon() {
    if (!existsSync(iconSourcePath)) {
        throw new Error(`Missing Windows icon source: ${iconSourcePath}`);
    }

    mkdirSync(buildDir, { recursive: true });
    const source = readFileSync(iconSourcePath);
    // An .ico is used as is; a single PNG (SERENITY_WINDOWS_ICON_SOURCE) is wrapped in one.
    const icoBuffer = iconSourcePath.toLowerCase().endsWith('.ico') ? source : packIco([source]);
    writeFileSync(iconOutputPath, icoBuffer);
    console.log(`[build:win] Windows icon: ${path.relative(projectRoot, iconSourcePath)} -> ${path.relative(projectRoot, iconOutputPath)}`);
}

if (!allowNonWindowsBuild) {
    console.error(
        '[build:win] Native Windows is the supported packaging path. Run this on Windows, or use `npm run build:win:wsl` as an unsupported WSL/Wine fallback.',
    );
    process.exit(1);
}

if (process.platform !== 'win32') {
    console.warn('[build:win] Running unsupported WSL/Wine fallback packaging path.');
}

// GPU preference launcher removed — app.commandLine.appendSwitch('force-high-performance-gpu')
// in main.js achieves the same effect without a custom C executable.

async function build() {
    // Release gates first (Phase 0.4): warns in dev, hard-fails under
    // SERENITY_RELEASE=1 (e.g. placeholder Steam AppID 480). runCommand exits
    // the process on a non-zero status, so a failed gate stops the build here.
    runCommand('node', ['scripts/release-gate-check.mjs']);

    ensureWindowsIcon();

    const viteDone = runCommandAsync('vite', ['build']);
    await viteDone;

    const electronBuilderArgs = ['--win', '--x64'];
    delete process.env.SERENITY_SKIP_ELECTRON_NODE_MODULE_SCAN;

    if (isUnsupportedWslFallback) {
        console.warn(
            '[build:win] WSL fallback will output win-unpacked only and skip Windows executable resource editing. Use native Windows `npm run build:win` for the installer build.',
        );
        process.env.SERENITY_SKIP_ELECTRON_NODE_MODULE_SCAN = '1';
        electronBuilderArgs.push('--dir', '--config.win.signAndEditExecutable=false');
    }

    runCommand('electron-builder', electronBuilderArgs);

    // Supply-chain: attach a CycloneDX SBOM of the shipped (prod) dependency
    // surface to release builds (Phase 0.5). Dev builds skip it.
    if (process.env.SERENITY_RELEASE === '1') {
        runCommand('npx', [
            '--yes', '@cyclonedx/cyclonedx-npm', '--omit', 'dev',
            '--output-file', path.join('release', 'sbom.json'),
        ]);
        console.log('[build:win] SBOM written to release/sbom.json');
    }
}

build().catch((error) => {
    console.error('[build:win] Build failed:', error.message);
    process.exit(1);
});
