import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    canonicalizeGitPorcelainStatus,
    createStillwaterSourceBuildFingerprint,
    resolveStillwaterManifestClosure,
    resolveStillwaterThemeAsset,
    STILLWATER_PROVENANCE_SCHEMA,
} from '../../scripts/stillwater-artifact-provenance.mjs';

const VALIDATION_LOGIC_FILES = Object.freeze([
    {
        path: 'scripts/stillwater-wave8-validation.mjs',
        bytes: Buffer.from('export const validation = true;\n'),
    },
    {
        path: 'scripts/stillwater-perf-budget.mjs',
        bytes: Buffer.from('export const budget = true;\n'),
    },
    {
        path: 'scripts/stillwater-artifact-provenance.mjs',
        bytes: Buffer.from('export const provenance = true;\n'),
    },
    {
        path: 'scripts/run-electron.mjs',
        bytes: Buffer.from('export const launcher = true;\n'),
    },
]);

const MANIFEST_CLOSURE_FILES = Object.freeze([
    {
        path: 'dist/assets/theme-stillwater-a.js',
        bytes: Buffer.from('export const stillwater = true;\n'),
    },
    {
        path: 'dist/assets/three-a.js',
        bytes: Buffer.from('export const three = true;\n'),
    },
    {
        path: 'dist/assets/troll-low-a.glb',
        bytes: Buffer.from([0x67, 0x6c, 0x54, 0x46]),
    },
]);

const INPUT = Object.freeze({
    gitHead: '0123456789abcdef0123456789abcdef01234567',
    gitStatus: '?? z-last.js\r\n M a-first.js\r\n',
    manifestBytes: Buffer.from('{"_theme-stillwater-a.js":{"file":"assets/theme-stillwater-a.js"}}'),
    manifestPath: 'dist\\manifest.json',
    manifestClosureFiles: MANIFEST_CLOSURE_FILES,
    manifestEntryKeys: ['_three-a.js', '_theme-stillwater-a.js'],
    performanceBudgetBytes: Buffer.from('{"budgets":{"frameP95Ms":{}}}\n'),
    performanceBudgetPath: 'perf-budgets.json',
    themeAssetPath: 'dist\\assets\\theme-stillwater-a.js',
    themeManifestKey: '_theme-stillwater-a.js',
    validationLogicFiles: VALIDATION_LOGIC_FILES,
});

describe('Stillwater artifact provenance', () => {
    it('resolves exactly one emitted Stillwater chunk from a Vite manifest', () => {
        expect(resolveStillwaterThemeAsset({
            'index.html': { file: 'assets/app-a.js' },
            '_theme-stillwater-a.js': {
                file: 'assets/theme-stillwater-a.js',
            },
        })).toEqual({
            manifestKey: '_theme-stillwater-a.js',
            file: 'assets/theme-stillwater-a.js',
        });

        expect(() => resolveStillwaterThemeAsset({})).toThrow(
            'Expected exactly one emitted Stillwater theme asset; found 0.',
        );
        expect(() => resolveStillwaterThemeAsset({
            first: { file: 'assets/theme-stillwater-a.js' },
            second: { file: 'assets/theme-stillwater-b.js' },
        })).toThrow(
            'Expected exactly one emitted Stillwater theme asset; found 2.',
        );
    });

    it('walks imports, dynamic imports, CSS, and assets into one sorted closure', () => {
        const manifest = {
            '_theme-stillwater-a.js': {
                file: 'assets/theme-stillwater-a.js',
                imports: ['_three-a.js', '_shared-a.js'],
                dynamicImports: ['_lazy-a.js'],
                assets: ['assets/troll-low-a.glb'],
                css: ['assets/stillwater-a.css'],
            },
            '_three-a.js': {
                file: 'assets/three-a.js',
            },
            '_shared-a.js': {
                file: 'assets/shared-a.js',
                imports: ['_deep-a.js'],
                assets: ['assets/shared-noise-a.png'],
            },
            '_deep-a.js': {
                file: 'assets/deep-a.js',
                imports: ['_theme-stillwater-a.js'],
            },
            '_lazy-a.js': {
                file: 'assets/lazy-a.js',
                assets: ['assets/lazy-a.bin'],
            },
        };

        expect(resolveStillwaterManifestClosure(manifest)).toEqual({
            themeManifestKey: '_theme-stillwater-a.js',
            themeAssetFile: 'assets/theme-stillwater-a.js',
            manifestEntryKeys: [
                '_deep-a.js',
                '_lazy-a.js',
                '_shared-a.js',
                '_theme-stillwater-a.js',
                '_three-a.js',
            ],
            files: [
                'assets/deep-a.js',
                'assets/lazy-a.bin',
                'assets/lazy-a.js',
                'assets/shared-a.js',
                'assets/shared-noise-a.png',
                'assets/stillwater-a.css',
                'assets/theme-stillwater-a.js',
                'assets/three-a.js',
                'assets/troll-low-a.glb',
            ],
        });
    });

    it('rejects missing dependency entries and unconfined emitted paths', () => {
        expect(() => resolveStillwaterManifestClosure({
            '_theme-stillwater-a.js': {
                file: 'assets/theme-stillwater-a.js',
                imports: ['_missing-a.js'],
            },
        })).toThrow('Missing Vite manifest dependency entry: _missing-a.js');

        expect(() => resolveStillwaterManifestClosure({
            '_theme-stillwater-a.js': {
                file: 'assets/theme-stillwater-a.js',
                assets: ['../outside.glb'],
            },
        })).toThrow('is not a confined relative build path');
    });

    it('canonicalizes full porcelain status independent of line endings and order', () => {
        expect(canonicalizeGitPorcelainStatus(
            '?? z-last.js\r\n M a-first.js\r\n',
        )).toBe(' M a-first.js\n?? z-last.js\n');
        expect(canonicalizeGitPorcelainStatus('')).toBe('');
    });

    it('produces a stable sorted v3 local-content identity', () => {
        const first = createStillwaterSourceBuildFingerprint(INPUT);
        const second = createStillwaterSourceBuildFingerprint({
            ...INPUT,
            gitStatus: ' M a-first.js\n?? z-last.js\n',
            manifestClosureFiles: [...MANIFEST_CLOSURE_FILES].reverse(),
            manifestEntryKeys: [...INPUT.manifestEntryKeys].reverse(),
            validationLogicFiles: [...VALIDATION_LOGIC_FILES].reverse(),
        });

        expect(first).toEqual(second);
        expect(first).toMatchObject({
            schema: STILLWATER_PROVENANCE_SCHEMA,
            scope: {
                kind: 'local-build-content-identity',
                cryptographicAttestation: false,
                servedBytesVerified: false,
                gitContextIncludedInFingerprint: false,
            },
            git: {
                head: INPUT.gitHead,
                dirty: true,
                statusEntryCount: 2,
            },
            build: {
                viteManifest: {
                    path: 'dist/manifest.json',
                    sizeBytes: INPUT.manifestBytes.length,
                },
                performanceBudget: {
                    path: 'perf-budgets.json',
                    sizeBytes: INPUT.performanceBudgetBytes.length,
                },
                stillwaterThemeAsset: {
                    manifestKey: INPUT.themeManifestKey,
                    path: 'dist/assets/theme-stillwater-a.js',
                },
                stillwaterManifestClosure: {
                    fileCount: MANIFEST_CLOSURE_FILES.length,
                    manifestEntryKeys: [
                        '_theme-stillwater-a.js',
                        '_three-a.js',
                    ],
                },
                validationHarness: {
                    path: 'scripts/stillwater-wave8-validation.mjs',
                },
                validationLogic: {
                    fileCount: 4,
                },
            },
        });
        expect(first.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(first.git.statusSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(first.build.stillwaterManifestClosure.sha256)
            .toMatch(/^[a-f0-9]{64}$/);
        expect(first.build.validationLogic.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('records Git context without letting repository activity change build identity', () => {
        const baseline = createStillwaterSourceBuildFingerprint(INPUT);
        const changedContext = createStillwaterSourceBuildFingerprint({
            ...INPUT,
            gitHead: 'fedcba9876543210fedcba9876543210fedcba98',
            gitStatus: ' M another-file.js\n',
        });

        expect(changedContext.fingerprintSha256).toBe(baseline.fingerprintSha256);
        expect(changedContext.git.head).not.toBe(baseline.git.head);
        expect(changedContext.git.statusSha256).not.toBe(baseline.git.statusSha256);
        expect(changedContext.git.statusEntryCount).toBe(1);
    });

    it('changes when closure bytes, budgets, or validation logic changes', () => {
        const baseline = createStillwaterSourceBuildFingerprint(INPUT)
            .fingerprintSha256;
        const variants = [
            { performanceBudgetBytes: Buffer.from('{"changed":true}\n') },
            {
                manifestClosureFiles: MANIFEST_CLOSURE_FILES.map((file, index) => (
                    index === 1
                        ? { ...file, bytes: Buffer.from('changed dependency') }
                        : file
                )),
            },
            {
                validationLogicFiles: VALIDATION_LOGIC_FILES.map((file, index) => (
                    index === 2
                        ? { ...file, bytes: Buffer.from('changed helper') }
                        : file
                )),
            },
        ];

        variants.forEach((variant) => {
            expect(createStillwaterSourceBuildFingerprint({
                ...INPUT,
                ...variant,
            }).fingerprintSha256).not.toBe(baseline);
        });
    });
});
