/**
 * Signatures on a Windows package (scripts/package-signature-policy.mjs, run by
 * scripts/verify-signatures.mjs after electron-builder).
 *
 * Smart App Control blocks an unsigned program it cannot vouch for, so a store build stops when
 * the game's executable or a native addon is not validly signed. Every other build only reports.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    UNREAD_SIGNATURE,
    evaluatePackageSignatures,
    requiresSignature,
} from '../../scripts/package-signature-policy.mjs';

const root = new URL('../../', import.meta.url);
const APP = 'Serenity Blocks.exe';
const STEAM_ADDON = 'resources/native_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node';
const KOFFI_ADDON = 'resources/native_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node';
const VALVE_DLL = 'resources/native_modules/steamworks.js/dist/win64/steam_api64.dll';

/** The package as Windows reads it today: nothing of the game's own is signed. */
const unsignedPackage = () => [
    { path: APP, status: 'NotSigned' },
    { path: STEAM_ADDON, status: 'NotSigned' },
    { path: KOFFI_ADDON, status: 'NotSigned' },
    { path: VALVE_DLL, status: 'Valid' },
    { path: 'ffmpeg.dll', status: 'NotSigned' },
];

const signedPackage = () => unsignedPackage()
    .map((row) => (row.path.endsWith('.dll') ? row : { ...row, status: 'Valid' }));

const evaluate = (files, options = {}) => evaluatePackageSignatures({
    files, appExecutable: APP, packageLabel: 'release/win-unpacked', ...options,
});

describe('which files must be signed', () => {
    it("requires the game's executable at the package root and every native addon, either slash", () => {
        expect(requiresSignature(APP, APP)).toBe(true);
        expect(requiresSignature('serenity blocks.EXE', APP)).toBe(true);
        expect(requiresSignature(STEAM_ADDON, APP)).toBe(true);
        expect(requiresSignature(KOFFI_ADDON.replaceAll('/', '\\'), APP)).toBe(true);
    });

    it("only reports Electron's and Valve's libraries and any other executable", () => {
        expect(requiresSignature(VALVE_DLL, APP)).toBe(false);
        expect(requiresSignature('ffmpeg.dll', APP)).toBe(false);
        expect(requiresSignature('resources/elevate.exe', APP)).toBe(false);
        expect(requiresSignature(`resources/${APP}`, APP)).toBe(false);
    });
});

describe('a store build (SERENITY_RELEASE=1)', () => {
    it('stops when the executable and the addons are unsigned, and says what to do', () => {
        const result = evaluate(unsignedPackage(), { isReleaseBuild: true });
        expect(result.failed).toBe(true);
        expect(result.unsigned.map((row) => row.path)).toEqual([APP, STEAM_ADDON, KOFFI_ADDON]);
        const [{ level, message }] = result.diagnostics;
        expect(level).toBe('error');
        for (const file of [APP, STEAM_ADDON, KOFFI_ADDON]) expect(message).toContain(file);
        expect(message).not.toContain('ffmpeg.dll');
        expect(message).toContain('Smart App Control');
        expect(message).toContain('CSC_LINK');
        expect(message).toContain('SERENITY_ALLOW_UNSIGNED=1');
    });

    it('passes once the executable and every addon are valid, whatever the other libraries say', () => {
        const result = evaluate(signedPackage(), { isReleaseBuild: true });
        expect(result.failed).toBe(false);
        expect(result.unsigned).toEqual([]);
        expect(result.required).toHaveLength(3);
        expect(result.diagnostics[0].level).toBe('info');
    });

    it('stops on one unsigned addon', () => {
        const files = signedPackage().map((row) => (row.path === KOFFI_ADDON ? { ...row, status: 'NotSigned' } : row));
        const result = evaluate(files, { isReleaseBuild: true });
        expect(result.failed).toBe(true);
        expect(result.unsigned.map((row) => row.path)).toEqual([KOFFI_ADDON]);
    });

    it.each(['NotTrusted', 'HashMismatch', 'UnknownError'])('treats %s as unsigned', (status) => {
        const files = signedPackage().map((row) => (row.path === APP ? { ...row, status } : row));
        const result = evaluate(files, { isReleaseBuild: true });
        expect(result.failed).toBe(true);
        expect(result.diagnostics[0].message).toContain(status);
    });

    it('lets a deliberate unsigned build through with a warning that names the files', () => {
        const result = evaluate(unsignedPackage(), { isReleaseBuild: true, allowUnsigned: true });
        expect(result.failed).toBe(false);
        const [{ level, message }] = result.diagnostics;
        expect(level).toBe('warning');
        expect(message).toContain('UNSIGNED STORE BUILD');
        expect(message).toContain(APP);
    });

    it('stops when the signatures cannot be read at all (a build off Windows)', () => {
        const files = unsignedPackage().map((row) => ({ ...row, status: UNREAD_SIGNATURE }));
        const result = evaluate(files, { isReleaseBuild: true });
        expect(result.failed).toBe(true);
        expect(result.diagnostics[0].message).toContain('cannot be read on this computer');
    });
});

describe('any other build', () => {
    it('reports the unsigned files without failing', () => {
        const result = evaluate(unsignedPackage());
        expect(result.failed).toBe(false);
        const [{ level, message }] = result.diagnostics;
        expect(level).toBe('warning');
        expect(message).toContain(STEAM_ADDON);
        expect(message).toContain('A store build (SERENITY_RELEASE=1) stops here.');
    });

    it('ignores SERENITY_ALLOW_UNSIGNED, which only speaks to a store build', () => {
        const result = evaluate(unsignedPackage(), { allowUnsigned: true });
        expect(result.failed).toBe(false);
        expect(result.diagnostics[0].message).not.toContain('UNSIGNED STORE BUILD');
    });
});

describe('a directory that is not a Windows package', () => {
    it.each([false, true])('fails without the executable (store build: %s)', (isReleaseBuild) => {
        const files = [{ path: 'resources/native_modules/steamworks.js/dist/linux64/steamworksjs.linux-x64-gnu.node', status: 'UnknownError' }];
        const result = evaluate(files, { isReleaseBuild, allowUnsigned: true });
        expect(result.failed).toBe(true);
        expect(result.diagnostics[0].message).toContain(`"${APP}" is not in release/win-unpacked`);
    });
});

describe('the Windows build', () => {
    it('reads the signatures of what it packaged, after electron-builder and before the SBOM', () => {
        // build-win.mjs runs its steps in source order; runCommand exits the build on a failure.
        const source = readFileSync(new URL('scripts/build-win.mjs', root), 'utf8');
        const packAt = source.indexOf("runCommand('electron-builder'");
        const checkAt = source.indexOf("runCommand('node', ['scripts/verify-signatures.mjs', unpackedDir])");
        const sbomAt = source.indexOf('@cyclonedx/cyclonedx-npm');
        expect(packAt).toBeGreaterThan(0);
        expect(checkAt).toBeGreaterThan(packAt);
        expect(sbomAt).toBeGreaterThan(checkAt);
        expect(source).toContain("const unpackedDir = path.join('release', 'win-unpacked');");
    });

    it("names the game's executable after the product, and has a script for a hand check", () => {
        const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
        expect(`${manifest.build.productName}.exe`).toBe(APP);
        expect(manifest.scripts['check:signatures']).toBe('node scripts/verify-signatures.mjs');
    });
});
