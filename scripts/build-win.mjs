import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');
const iconOutputPath = path.join(buildDir, 'icon.ico');
const defaultIconSource = path.join(projectRoot, 'public', 'assets', 'themes', 'forest-theme-icon.png');
const iconSourcePath = process.env.SERENITY_WINDOWS_ICON_SOURCE
    ? path.resolve(projectRoot, process.env.SERENITY_WINDOWS_ICON_SOURCE)
    : defaultIconSource;
const allowNonWindowsBuild = process.platform === 'win32' || process.env.SERENITY_ALLOW_WSL_WIN_BUILD === '1';

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

function readPngDimensions(buffer) {
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
        throw new Error('Windows icon source must be a PNG file.');
    }

    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function createIcoFromPng(pngBuffer) {
    const { width, height } = readPngDimensions(pngBuffer);
    const iconDirectory = Buffer.alloc(16);
    const header = Buffer.alloc(6);

    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);

    iconDirectory.writeUInt8(width >= 256 ? 0 : width, 0);
    iconDirectory.writeUInt8(height >= 256 ? 0 : height, 1);
    iconDirectory.writeUInt8(0, 2);
    iconDirectory.writeUInt8(0, 3);
    iconDirectory.writeUInt16LE(1, 4);
    iconDirectory.writeUInt16LE(32, 6);
    iconDirectory.writeUInt32LE(pngBuffer.length, 8);
    iconDirectory.writeUInt32LE(header.length + iconDirectory.length, 12);

    return Buffer.concat([header, iconDirectory, pngBuffer]);
}

function ensureWindowsIcon() {
    if (!existsSync(iconSourcePath)) {
        throw new Error(`Missing Windows icon source: ${iconSourcePath}`);
    }

    mkdirSync(buildDir, { recursive: true });
    const pngBuffer = readFileSync(iconSourcePath);
    const icoBuffer = createIcoFromPng(pngBuffer);
    writeFileSync(iconOutputPath, icoBuffer);
    console.log(`[build:win] Generated Windows icon: ${path.relative(projectRoot, iconOutputPath)}`);
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

ensureWindowsIcon();
runCommand('vite', ['build']);
runCommand('electron-builder', ['--win', '--x64']);
