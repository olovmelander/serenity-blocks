import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    describe,
    expect,
    it,
} from 'vitest';
import {
    THEME_VALIDATION_CONCURRENCY,
    buildThemeWorkerArgs,
    parseThemeValidationArgs,
    resolveThemeValidationEntries,
} from '../../scripts/validate-all-themes.mjs';
import {
    THEME_REGISTRY,
    getThemeIds,
} from '../../src/themes/theme-registry.js';

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
);

describe('all-theme capture orchestration', () => {
    it('derives the default validation matrix directly from the theme registry', () => {
        const options = parseThemeValidationArgs([]);
        const entries = resolveThemeValidationEntries(options);

        expect(entries.map(({ id }) => id)).toEqual(getThemeIds());
        expect(entries).toHaveLength(THEME_REGISTRY.length);
        expect(THEME_VALIDATION_CONCURRENCY).toBe(1);
    });

    it('supports targeted runs without allowing unknown registry ids', () => {
        const targeted = parseThemeValidationArgs([
            '--theme',
            'neon-district',
            '--theme=forest',
            'neon-district',
        ]);

        expect(targeted.requestedThemeIds).toEqual([
            'neon-district',
            'forest',
        ]);
        expect(
            resolveThemeValidationEntries(targeted).map(({ id }) => id),
        ).toEqual(['neon-district', 'forest']);

        expect(() => resolveThemeValidationEntries(
            parseThemeValidationArgs(['--theme', 'missing-theme']),
        )).toThrow('Unknown theme id: missing-theme.');
    });

    it('rejects ambiguous all-plus-target selection', () => {
        expect(() => parseThemeValidationArgs([
            '--all',
            '--theme',
            'forest',
        ])).toThrow('--all cannot be combined');
    });

    it('rejects unknown, duplicate, missing, and invalid option values', () => {
        expect(() => parseThemeValidationArgs([
            '--theem',
            'neon-district',
        ])).toThrow('Unknown option "--theem"');
        expect(() => parseThemeValidationArgs([
            '--port',
            '4174',
            '--port',
            '4175',
        ])).toThrow('Option "--port" may only be specified once');
        expect(() => parseThemeValidationArgs([
            '--out',
        ])).toThrow('Option "--out" requires a value');
        expect(() => parseThemeValidationArgs([
            '--worker-timeout-ms',
            'never',
        ])).toThrow('--worker-timeout-ms must be a positive integer');
        expect(() => parseThemeValidationArgs([
            '--headed=perhaps',
        ])).toThrow('Expected a boolean value');
    });

    it('builds one-theme worker arguments with no batching surface', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'neon-district');
        const args = buildThemeWorkerArgs({
            entry,
            baseUrl: 'http://127.0.0.1:4174/',
            outputDir: path.join(repoRoot, 'docs', 'theme-screenshots'),
            runId: 'test-run',
            settleMs: 0,
            headed: false,
        });

        expect(path.basename(args[0])).toBe('capture-theme-screenshots.mjs');
        expect(args[1]).toBe('--');
        expect(args.filter((value) => value === '--theme')).toHaveLength(1);
        expect(args[args.indexOf('--theme') + 1]).toBe('neon-district');
        expect(args).not.toContain('forest');
    });

    it('routes the package capture command through the safe orchestrator', () => {
        const packageJson = JSON.parse(readFileSync(
            path.join(repoRoot, 'package.json'),
            'utf8',
        ));

        expect(packageJson.scripts['capture:themes']).toBe(
            'node scripts/validate-all-themes.mjs',
        );
    });

    it('keeps the Electron worker registry-driven and lifecycle-gated', () => {
        const source = readFileSync(
            path.join(repoRoot, 'scripts', 'capture-theme-screenshots.mjs'),
            'utf8',
        );
        const orchestratorSource = readFileSync(
            path.join(repoRoot, 'scripts', 'validate-all-themes.mjs'),
            'utf8',
        );

        expect(source).toContain("from '../src/themes/theme-registry.js'");
        expect(source).not.toContain('const ALL_THEMES');
        expect(source).toMatch(
            /const result = await bounded\(\s*manager\.switchTheme\(themeId, true\)/,
        );
        expect(source).toContain("'render-process-gone'");
        expect(source).toContain("'unresponsive'");
        expect(source).toContain("'did-fail-load'");
        expect(source).toContain('outgoing-cleanup-complete');
        expect(source).toContain('no-mode-lifecycle-call-');
        expect(source).toContain("const validationModeId = 'single'");
        expect(source).toContain('gameStateReady');
        expect(source).toContain('sameSessionGeneration');
        expect(source).toContain('gameplayLifecycleCalls');
        expect(source).toContain('restartSignals');
        expect(source).toContain("'gameStateReset'");
        expect(source).toContain("'boardSceneRestart'");
        expect(source).toContain('deterministicPauseApplied');
        expect(source).toContain('renderProbePassed(firstRenderProbe)');
        expect(source).toContain("'shared-background-renderer'");
        expect(source).toContain('themeOwnedHeartbeatObserved');
        expect(source).toContain('sharedRendererHeartbeatObserved');
        expect(source).toContain('outgoing-dedicated-renderer-terminal');
        expect(source).toContain('outgoing-renderer-field-cleared-or-shared');
        expect(source).toContain("'postProcessing'");
        expect(source).toContain("'particleSystem'");
        expect(source).toContain('single-active-container-');
        expect(orchestratorSource).toContain('ensurePreviewServer');
        expect(orchestratorSource).toContain('Preview health check failed; restarting');
    });

    it('lists the complete matrix without starting Electron or a preview server', () => {
        const result = spawnSync(
            process.execPath,
            [
                path.join(repoRoot, 'scripts', 'validate-all-themes.mjs'),
                '--list',
            ],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                timeout: 15_000,
            },
        );
        const listedIds = result.stdout
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => line.split('\t')[0]);

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(listedIds).toEqual(getThemeIds());
    });

    it('prints help without starting Electron or a preview server', () => {
        const result = spawnSync(
            process.execPath,
            [
                path.join(repoRoot, 'scripts', 'validate-all-themes.mjs'),
                '--help',
            ],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                timeout: 15_000,
            },
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('--base-url <url>');
        expect(result.stdout).toContain('--worker-timeout-ms <ms>');
        expect(result.stdout).toContain('--failure-cooldown-ms <ms>');
        expect(result.stdout).toContain('--headed[=<boolean>]');
        expect(result.stdout).not.toContain('Starting production preview');
    });

    it('fails fast on a misspelled option instead of launching the full matrix', () => {
        const result = spawnSync(
            process.execPath,
            [
                path.join(repoRoot, 'scripts', 'validate-all-themes.mjs'),
                '--theem',
                'neon-district',
            ],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                timeout: 15_000,
            },
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Unknown option "--theem"');
        expect(result.stdout).not.toContain('Starting production preview');
    });
});
