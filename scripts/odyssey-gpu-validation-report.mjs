import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTER_SCENES } from '../src/rendering/odyssey/chapter-environments/registry.js';

/** The chapter registry plus the pilot's non-chapter scenes, shared by runner and gate. */
export const ALL_SCENES = Object.freeze([
    ...CHAPTER_SCENES.map((entry) => entry.sceneId),
    'path', 'level-nodes', 'threshold-breach',
]);

export function resolveValidationScenes(filter = '') {
    const requested = filter.split(',').map((scene) => scene.trim()).filter(Boolean);
    const unknown = requested.filter((scene) => !ALL_SCENES.includes(scene));
    if (unknown.length) throw new Error(`Unknown Odyssey validation scene(s): ${[...new Set(unknown)].join(', ')}`);
    return requested.length ? ALL_SCENES.filter((scene) => requested.includes(scene)) : [...ALL_SCENES];
}

/** Invalidate the previous verdict before any operation that can fail or crash. */
export async function resetValidationReport(reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await rm(reportPath, { force: true });
}

/** Require one successful result for every expected scene; an empty report is never proof. */
export function evaluateValidationReport(report, expectedScenes = ALL_SCENES) {
    const errors = [];
    if (!Array.isArray(report) || report.length === 0) {
        return { ok: false, clean: 0, total: 0, errors: ['report must be a nonempty array of scene results'] };
    }
    if (!Array.isArray(expectedScenes) || expectedScenes.length === 0) {
        return { ok: false, clean: 0, total: report.length, errors: ['expected scene list must not be empty'] };
    }
    const expected = new Set(expectedScenes);
    const seen = new Set();
    let clean = 0;
    report.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.scene !== 'string') {
            errors.push(`result ${index + 1} is not a scene result`);
            return;
        }
        if (!expected.has(entry.scene)) errors.push(`unexpected scene: ${entry.scene}`);
        if (seen.has(entry.scene)) errors.push(`duplicate scene: ${entry.scene}`);
        seen.add(entry.scene);
        if (entry.ok !== true) {
            const reasons = Array.isArray(entry.reasons) ? entry.reasons.join('; ') : '';
            errors.push(`${entry.scene}: ${reasons || 'scene did not pass'}`);
        } else if (!Array.isArray(entry.reasons) || entry.reasons.length !== 0) {
            errors.push(`${entry.scene}: successful result must have an empty reasons array`);
        } else {
            clean += 1;
        }
    });
    expected.forEach((scene) => {
        if (!seen.has(scene)) errors.push(`missing scene: ${scene}`);
    });
    return { ok: errors.length === 0, clean, total: report.length, errors };
}

async function main() {
    const reportPath = process.argv[2];
    if (!reportPath) throw new Error('Usage: node scripts/odyssey-gpu-validation-report.mjs <report.json>');
    const verdict = evaluateValidationReport(JSON.parse(await readFile(reportPath, 'utf8')));
    console.log(`GPU render verdict: ${verdict.clean}/${verdict.total} scenes clean`);
    if (!verdict.ok) throw new Error(verdict.errors.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`GATE FAIL: ${error.message}`);
        process.exitCode = 1;
    });
}
