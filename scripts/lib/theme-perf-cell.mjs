/**
 * Theme perf lane — the committed cell builder and its void rules. Pure: no Electron, no fs.
 *
 * ADR-0016 shapes every rule here:
 *  - a `null` never travels alone; it always has a `*Reason` sibling saying why,
 *  - a differential between two visits is VOIDED when the content did not match, rather than
 *    published with a caveat,
 *  - `admissible` is an AND over the guards, and every failed guard is named in
 *    `inadmissibleReasons` so a reader never has to infer why a cell is not usable.
 */

import { contentMismatch, pinsBrokenReason } from './theme-perf-instrument.mjs';

export const THEME_PERF_CELL_SCHEMA_VERSION = 1;

const NOTES = [
    'firstFrameGpuDoneMs is GPU-work completion for the first frame, not scanout. A page cannot observe presentation.',
    'allQuiescedGpuDoneMs INCLUDES a 2000-2100 ms compile-quiet wait by construction. It is not a latency; use firstFrameGpuDoneMs for that.',
    'pipelines.asyncSumMs is the sum of per-object awaited compiles (r185 Renderer awaits per object), not a wall-clock.',
    'pipelines.syncRows always carry ms=null: createRenderPipeline returns at once and the GPU process blocks at first draw.',
    'gpuMs is null for a classic THREE.WebGLRenderer: that renderer kind has no timestamp API in 0.185.1 (ADR-0019, ADR-0008).',
    'Two configurations inside 0.065536 ms mean "difference below resolution", never "zero cost" (ADR-0016).',
    'GPU samples are pushed once per RESOLVED query, never once per frame: Info.reset() does not clear render.timestamp.',
];

/**
 * @param {object} input
 * @param {string} input.theme
 * @param {string} input.anchorTheme
 * @param {object} input.themeMeta
 * @param {object} input.manifest
 * @param {object} input.visit1  reduced visit payload (the cold-in-process build)
 * @param {object} [input.visit2] reduced visit payload (the warm repeat; drift + content guard)
 * @param {object} [input.adapter]
 * @param {object} [input.consoleSummary]
 * @param {string} input.runId
 * @param {string} input.generatedAt
 */
export function buildThemePerfCell({
    theme, anchorTheme, themeMeta, manifest, visit1, visit2 = null,
    adapter = null, consoleSummary = null, runId, generatedAt,
}) {
    const inadmissible = [];
    // Kept apart on purpose: a cell can carry sound single-visit timings while its visit-to-visit
    // differential is void.
    const driftInadmissible = [];

    if (!visit1 || visit1.error) {
        return {
            schemaVersion: THEME_PERF_CELL_SCHEMA_VERSION,
            generatedAt,
            runId,
            theme,
            anchorTheme,
            themeMeta: themeMeta ?? null,
            manifest,
            admissible: false,
            inadmissibleReasons: [`visit 1 failed: ${visit1 ? visit1.error : 'no payload'}`],
            notes: NOTES,
        };
    }

    const pinsReason = pinsBrokenReason(visit1.pins);
    if (pinsReason) inadmissible.push(`pins: ${pinsReason}`);

    if (!visit1.idle || !visit1.idle.wall || visit1.idle.wall.samples === 0) {
        inadmissible.push('no wall-frame samples in the idle window');
    }

    // A classic WebGLRenderer legitimately has no GPU series; a theme with no three renderer at all
    // has neither. Both are renderer kind, not defects (ADR-0019, ADR-0008).
    const kind = visit1.renderer?.kind ?? null;
    const gpuExpected = kind === 'WebGPURenderer';
    if (gpuExpected && (visit1.idle?.gpuMs?.samples ?? 0) === 0) {
        inadmissible.push(`no GPU timestamp samples (${visit1.idle?.gpuNullReason ?? 'unknown reason'})`);
    }
    if (visit1.idle?.gpuMs?.stickySamplerSuspected) {
        inadmissible.push('GPU sample count >= frame count — sticky-sampler signature (ADR-0016)');
    }
    if (consoleSummary && consoleSummary.errorCount > 0) {
        inadmissible.push(`${consoleSummary.errorCount} console error(s) during the run`);
    }

    // Two-visit differential. Voided, never caveated, when the content did not match.
    let drift = { visitGpuP50DeltaMs: null, visitWallP95DeltaMs: null, voidReason: 'no second visit' };
    let content = {
        ...visit1.content, visit2: null, contentMatch: null, contentMismatchReason: null, contentGuardAdmissible: false,
    };
    const hasRenderer = kind === 'WebGPURenderer' || kind === 'WebGLRenderer';
    if (visit2 && !visit2.error) {
        // 0 draws is "nothing observed", not "content matched". For a theme that owns no three
        // renderer that is the expected state, not a fault.
        const noContent = !(visit1.content?.drawCalls?.p50 > 0);
        const mismatch = noContent
            ? noContentReason(hasRenderer)
            : contentMismatch(visit1, visit2);
        content = {
            ...visit1.content,
            visit2: {
                drawCalls: visit2.content?.drawCalls?.p50 ?? null,
                triangles: visit2.content?.triangles?.p50 ?? null,
            },
            contentMatch: mismatch === null,
            contentMismatchReason: mismatch,
            contentGuardAdmissible: mismatch === null,
        };
        drift = mismatch
            ? { visitGpuP50DeltaMs: null, visitWallP95DeltaMs: null, voidReason: mismatch }
            : {
                visitGpuP50DeltaMs: diff(visit1.idle?.gpuMs?.p50, visit2.idle?.gpuMs?.p50),
                visitWallP95DeltaMs: diff(visit1.idle?.wall?.p95, visit2.idle?.wall?.p95),
                voidReason: null,
            };
        // Only the DIFFERENTIAL is disqualified by a mismatch; see the note above.
        if (mismatch && hasRenderer) driftInadmissible.push(`content guard: ${mismatch}`);
    } else {
        inadmissible.push('no second visit — content guard could not run');
    }

    return {
        schemaVersion: THEME_PERF_CELL_SCHEMA_VERSION,
        generatedAt,
        runId,
        theme,
        anchorTheme,
        themeMeta: themeMeta ?? null,
        manifest,
        pins: {
            observedAtWindowStart: visit1.pins?.atStart ?? null,
            observedAtWindowEnd: visit1.pins?.atEnd ?? null,
            pinsHeld: pinsReason === null,
            pinsBrokenReason: pinsReason,
        },
        renderer: visit1.renderer,
        adapter,
        pipelines: {
            ...visit1.pipelines,
            visit2AsyncCount: visit2?.pipelines?.asyncCount ?? null,
            visit2SyncCount: visit2?.pipelines?.syncCount ?? null,
        },
        switchTimings: {
            ...visit1.switchTimings,
            visit2SwitchWallMs: visit2?.switchTimings?.switchWallMs ?? null,
        },
        idle: visit1.idle,
        content,
        memory: visit1.memory,
        drift: { ...drift, admissible: driftInadmissible.length === 0, inadmissibleReasons: driftInadmissible },
        console: consoleSummary
            ? { errorCount: consoleSummary.errorCount, warningCount: consoleSummary.warningCount }
            : null,
        admissible: inadmissible.length === 0,
        inadmissibleReasons: inadmissible,
        notes: NOTES,
    };
}

/** Why a content comparison could not run. A theme with no three renderer draws nothing BY DESIGN. */
function noContentReason(hasRenderer) {
    return hasRenderer
        ? 'no draw calls observed — content guard cannot run'
        : 'theme owns no three renderer — nothing to content-match';
}

function diff(a, b) {
    return (Number.isFinite(a) && Number.isFinite(b)) ? +Math.abs(b - a).toFixed(3) : null;
}

/**
 * Rank a set of cells the way Stage 3 asks for: worst single pipeline compile, first-entry wall
 * clock, idle p95 and its split, allocation rate. Pure; inadmissible cells are kept and flagged
 * rather than dropped.
 */
export function rankThemePerfCells(cells) {
    return cells
        .map((c) => ({
            theme: c.theme,
            admissible: c.admissible,
            worstPipelineMs: c.pipelines?.asyncMaxMs ?? null,
            syncPipelines: c.pipelines?.syncCount ?? null,
            switchWallMs: c.switchTimings?.switchWallMs ?? null,
            firstFrameGpuDoneMs: c.switchTimings?.firstFrameGpuDoneMs ?? null,
            allQuiescedGpuDoneMs: c.switchTimings?.allQuiescedGpuDoneMs ?? null,
            idleWallP95: c.idle?.wall?.p95 ?? null,
            idleCpuP95: c.idle?.cpuSubmitMs?.p95 ?? null,
            idleGpuP95: c.idle?.gpuMs?.p95 ?? null,
            allocBytesPerFrame: c.memory?.allocBytesPerFrame ?? null,
            gcPerSecond: c.memory?.gcPerSecond ?? null,
            drawCalls: c.content?.drawCalls?.p50 ?? null,
            kind: c.renderer?.kind ?? null,
        }))
        .sort((a, b) => (b.worstPipelineMs ?? -1) - (a.worstPipelineMs ?? -1)
            || (b.switchWallMs ?? -1) - (a.switchWallMs ?? -1));
}
