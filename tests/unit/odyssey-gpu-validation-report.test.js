import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import {
    ALL_SCENES,
    evaluateValidationReport,
    resetValidationReport,
    resolveValidationScenes,
} from '../../scripts/odyssey-gpu-validation-report.mjs';

const gatePath = fileURLToPath(new URL('../../scripts/odyssey-gpu-validation-report.mjs', import.meta.url));
const harnessSource = readFileSync(new URL('../../scripts/odyssey-webgpu-validation.mjs', import.meta.url), 'utf8');
const runSource = harnessSource.slice(harnessSource.indexOf('async function run()'), harnessSource.indexOf('\napplyGpuSwitches();'));
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'serenity-gpu-report-'));
    roots.push(root);
    return path.join(root, 'report.json');
}

const completeReport = () => ALL_SCENES.map((scene) => ({ scene, ok: true, backend: 'WebGPU', reasons: [] }));

describe('Odyssey validation scene selection', () => {
    it('uses the full registry by default and deduplicates a valid subset', () => {
        expect(resolveValidationScenes()).toEqual(ALL_SCENES);
        expect(resolveValidationScenes('path, earth-core, path')).toEqual(['earth-core', 'path']);
    });

    it.each(['typo-scene', 'path,typo-scene'])('rejects unknown names instead of a partial or empty sweep: %s', (filter) => {
        expect(() => resolveValidationScenes(filter)).toThrow(/Unknown.*typo-scene/);
    });
});

describe('Odyssey GPU report verdict', () => {
    it('accepts a complete successful sweep in any order', () => {
        const verdict = evaluateValidationReport(completeReport().reverse());
        expect(verdict).toEqual({ ok: true, clean: ALL_SCENES.length, total: ALL_SCENES.length, errors: [] });
    });

    it.each([null, {}, [], false])('fails malformed or empty reports: %j', (report) => {
        expect(evaluateValidationReport(report).ok).toBe(false);
    });

    it('fails an incomplete report even when every reported scene passed', () => {
        const verdict = evaluateValidationReport(completeReport().slice(1));
        expect(verdict.ok).toBe(false);
        expect(verdict.errors).toContain(`missing scene: ${ALL_SCENES[0]}`);
    });

    it('fails duplicate and unknown scenes instead of accepting a matching row count', () => {
        const report = completeReport();
        report[1] = report[0];
        report.push({ scene: 'unknown', ok: true, reasons: [] });
        const verdict = evaluateValidationReport(report);
        expect(verdict.ok).toBe(false);
        expect(verdict.errors).toContain(`duplicate scene: ${ALL_SCENES[0]}`);
        expect(verdict.errors).toContain(`missing scene: ${ALL_SCENES[1]}`);
        expect(verdict.errors).toContain('unexpected scene: unknown');
    });

    it.each([null, { ok: true }, { scene: 'path', ok: 'true', reasons: [] }, { scene: 'path', ok: true, reasons: ['shader error'] }])(
        'fails invalid scene records: %j', (entry) => {
            const report = completeReport().filter((result) => result.scene !== 'path');
            report.push(entry);
            expect(evaluateValidationReport(report).ok).toBe(false);
        },
    );

    it('reports a failing scene and its reasons', () => {
        const report = completeReport();
        report[0].ok = false;
        report[0].reasons = ['scene never signalled ready'];
        const verdict = evaluateValidationReport(report);
        expect(verdict.ok).toBe(false);
        expect(verdict.errors).toContain(`${ALL_SCENES[0]}: scene never signalled ready`);
    });
});

describe('GPU report CLI', () => {
    it.each([
        ['complete', () => completeReport(), 0],
        ['empty', () => [], 1],
        ['incomplete', () => completeReport().slice(1), 1],
    ])('gives the right exit status for a %s report', (_name, report, status) => {
        const reportPath = fixture();
        writeFileSync(reportPath, JSON.stringify(report()));
        const result = spawnSync(process.execPath, [gatePath, reportPath], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(status);
        if (status !== 0) expect(result.stderr).toContain('GATE FAIL');
    });

    it('fails when the harness left no report or malformed JSON', () => {
        const reportPath = fixture();
        for (const content of [null, '{']) {
            if (content !== null) writeFileSync(reportPath, content);
            const result = spawnSync(process.execPath, [gatePath, reportPath], { encoding: 'utf8' });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('GATE FAIL');
        }
    });
});

describe('harness verdict invalidation before startup', () => {
    it.each(['unknown-scene', ''])('removes an old successful verdict before a startup failure (filter %j)', async (filter) => {
        const reportPath = fixture();
        writeFileSync(reportPath, JSON.stringify(completeReport()));
        const startDevServer = vi.fn(() => { throw new Error('simulated startup failure'); });

        // Run the actual startup body with a server failure; no Electron/GPU is launched.
        const run = runInNewContext(`${runSource}\nrun()`, {
            REPORT_PATH: reportPath,
            resetValidationReport,
            resolveValidationScenes,
            process: { env: { ODYSSEY_VALIDATION_SCENES: filter } },
            startDevServer,
            devServer: null,
        });
        await expect(run).rejects.toThrow(filter ? 'Unknown Odyssey' : 'simulated startup failure');
        await expect(access(reportPath)).rejects.toThrow();
        expect(startDevServer).toHaveBeenCalledTimes(filter ? 0 : 1);
    });
});
