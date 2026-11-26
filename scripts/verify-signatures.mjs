// @ts-check
/**
 * Reports the Authenticode signature of every .exe, .dll and .node in an unpacked Windows package,
 * and stops a store build whose executable or native addons are not validly signed.
 *
 *   node scripts/verify-signatures.mjs [release/win-unpacked]
 *
 * release/win-unpacked is what Steam's Windows depot is staged from; scripts/build-win.mjs runs
 * this on it after electron-builder. The rule and the wording live in
 * scripts/package-signature-policy.mjs. Exit 1 only when that rule fails: a store build
 * (SERENITY_RELEASE=1) with an unsigned required file and no SERENITY_ALLOW_UNSIGNED=1, or a
 * directory that is not a package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    SIGNATURE_EXTENSIONS,
    UNREAD_SIGNATURE,
    evaluatePackageSignatures,
    requiresSignature,
} from './package-signature-policy.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// One PowerShell start for the whole package. The directory travels in the environment, so no
// path is ever quoted into the command. UTF-8 out, since a signer's name need not be ASCII.
const READ_SIGNATURES = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$kinds = $env:SERENITY_SIGNATURE_KINDS -split ','
$rows = Get-ChildItem -LiteralPath $env:SERENITY_SIGNATURE_ROOT -Recurse -File |
    Where-Object { $kinds -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
        $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
        $signer = $null
        if ($signature.SignerCertificate) { $signer = $signature.SignerCertificate.Subject }
        [pscustomobject]@{ path = $_.FullName; status = $signature.Status.ToString(); signer = $signer }
    }
ConvertTo-Json -InputObject @($rows) -Compress
`;

/** @param {string} directory @returns {string[]} every signable file under it, absolute */
function listSignableFiles(directory) {
    return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && SIGNATURE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
        .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * Each signable file's Authenticode status, as Windows reads it. On any other system, or when
 * PowerShell cannot be started, every file comes back `Unread`.
 * @param {string} directory absolute path of the unpacked package
 * @returns {{ rows: Array<{ path: string, status: string, signer?: string | null }>, note: string | null }}
 */
export function readPackageSignatures(directory) {
    const relative = (/** @type {string} */ file) => path.relative(directory, file).replaceAll('\\', '/');
    const unread = (/** @type {string} */ note) => ({
        rows: listSignableFiles(directory).map((file) => ({ path: relative(file), status: UNREAD_SIGNATURE, signer: null })),
        note,
    });
    if (process.platform !== 'win32') return unread('Authenticode signatures are read on Windows only.');

    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', READ_SIGNATURES], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: {
            ...process.env,
            SERENITY_SIGNATURE_ROOT: directory,
            SERENITY_SIGNATURE_KINDS: SIGNATURE_EXTENSIONS.join(','),
        },
    });
    if (run.status !== 0 || !run.stdout.trim()) {
        return unread(`PowerShell could not read the signatures: ${(run.error?.message || run.stderr || 'no output').trim().split('\n')[0]}`);
    }
    /** @type {Array<{ path: string, status: string, signer: string | null }>} */
    const rows = JSON.parse(run.stdout);
    return { rows: rows.map((row) => ({ ...row, path: relative(row.path) })), note: null };
}

function main() {
    const target = path.resolve(projectRoot, process.argv[2] || path.join('release', 'win-unpacked'));
    const label = path.relative(projectRoot, target).replaceAll('\\', '/') || '.';
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        console.error(`[signatures] ${label} is not a directory. Usage: node scripts/verify-signatures.mjs [release/win-unpacked]`);
        process.exit(1);
    }
    const { productName } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).build;
    const appExecutable = `${productName}.exe`;

    const { rows, note } = readPackageSignatures(target);
    console.log(`[signatures] ${label}: ${rows.length} signable file(s)`);
    if (note) console.log(`[signatures] ${note}`);
    for (const row of [...rows].sort((a, b) => a.path.localeCompare(b.path))) {
        const mark = requiresSignature(row.path, appExecutable) ? '*' : ' ';
        const signer = row.signer ? `  (${/CN=("[^"]+"|[^,]+)/.exec(row.signer)?.[1] ?? row.signer})` : '';
        console.log(`  ${mark} ${row.status.padEnd(12)} ${row.path}${signer}`);
    }
    console.log('  * must be validly signed in a store build');

    const result = evaluatePackageSignatures({
        files: rows,
        appExecutable,
        isReleaseBuild: process.env.SERENITY_RELEASE === '1',
        allowUnsigned: process.env.SERENITY_ALLOW_UNSIGNED === '1',
        packageLabel: label,
    });
    for (const { level, message } of result.diagnostics) {
        const print = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
        print(`[signatures] ${message}`);
    }
    if (result.failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
