/**
 * @fileoverview Reduce a V8 .cpuprofile to the self-time table plan item 4.1 asks for.
 *
 * WHY 4.1 EXISTS. Lane A's Odyssey frame is ~11 ms wall of which the GPU is ~1.44 ms, and the
 * per-pass split now shows one pass carrying 91% of that GPU time. So ~9.5 ms a frame is CPU and
 * has never been attributed. The plan states outright that nothing else in Phase 4 is admissible
 * until this profile exists, because two of its remaining items (the 619 `uniform()` calls with
 * zero `renderGroup`, and the 122 `frustumCulled = false` sites) are CPU claims that no GPU
 * differential can ever confirm or refute.
 *
 * Kept out of odyssey-perf-session.mjs so it can be tested against a committed fixture without
 * Electron, a GPU, or a 10-second capture (precedent: scripts/lib/hitch-stats.mjs).
 */

/** Nodes V8 emits that represent time NOT spent in application JS. */
const IDLE_NODE_NAMES = new Set(['(idle)', '(program)', '(garbage collector)', '(root)']);

/**
 * The functions plan item 4.1 names, plus how to recognise each one.
 *
 * `url` disambiguates a bare function name where it can — `_update` and `update` match dozens of
 * unrelated methods — but see THREE_URLS below for why it can do less than it looks.
 *
 * CORRECTED BY THE FIRST CAPTURE (2026-08-23): the expectation going in was that
 * `device.queue.writeBuffer` could never appear as its own row, being a Blink binding with no JS
 * frame, and that its time would fold into the self-time of its callers `updateBinding` /
 * `updateAttribute`. Under Electron that is NOT what happens — V8 surfaces `writeBuffer`,
 * `submit` and `setVertexBuffer` as their own nodes with an EMPTY url, and the JS callers do not
 * appear at all. So they are matched by name with no url constraint, and the caller-based targets
 * were removed rather than left reporting null forever.
 */
/**
 * Where three's frames actually come from. Against the DEV SERVER three is pre-bundled by Vite
 * into `node_modules/.vite/deps/chunk-<hash>.js`, so matching on a source filename like
 * 'Bindings.js' finds nothing — the first 4.1 capture reported every three target as absent while
 * _renderObjectDirect sat at the top of the table. Against a preview build it is minified into an
 * app chunk instead. Accept either shape.
 *
 * COST OF THIS: inside a dep chunk the url can no longer disambiguate a generic name, so
 * `three.bindingsUpdate` matches any `_update` in the bundled deps, not strictly
 * Bindings._update. It is still separated from the APP's `_update` methods, which is the
 * distinction that matters; treat the row as "three-side _update".
 */
const THREE_URLS = ['three', '.vite/deps/'];
/** App frames keep real paths in dev; in a preview build these go absent rather than wrong. */
const APP_URLS = ['OdysseyBoardController'];

export const CPU_PROFILE_TARGETS = [
    { key: 'three.renderObjectDirect', fn: '_renderObjectDirect', url: THREE_URLS },
    { key: 'three.bindingsUpdate', fn: '_update', url: THREE_URLS },
    { key: 'three.updateForRender', fn: 'updateForRender', url: THREE_URLS },
    { key: 'three.updateMatrixWorld', fn: 'updateMatrixWorld', url: THREE_URLS },
    { key: 'three.draw', fn: '_draw', url: THREE_URLS },
    // Native/Blink frames: no JS url at all, so they can only be matched by name. V8 DOES
    // surface these as their own nodes under Electron — worth knowing, because the usual
    // advice is that a Blink binding's time is folded into its JS caller's self-time.
    { key: 'gpu.writeBuffer', fn: 'writeBuffer', url: null },
    { key: 'gpu.submit', fn: 'submit', url: null },
    { key: 'gpu.setVertexBuffer', fn: 'setVertexBuffer', url: null },
    // Things that should NOT be hot in a steady-state render loop; listed so a regression is
    // visible rather than buried in the tail.
    { key: 'dom.getBoundingClientRect', fn: 'getBoundingClientRect', url: null },
    { key: 'audio.getByteFrequencyData', fn: 'getByteFrequencyData', url: null },
    { key: 'app.animate', fn: 'animate', url: APP_URLS },
    { key: 'app.renderFrame', fn: 'renderFrame', url: APP_URLS },
    { key: 'app.update', fn: 'update', url: APP_URLS },
];

/**
 * @param {object} profile - a V8 profile as returned by CDP `Profiler.stop`.
 * @param {object} [options]
 * @param {number} [options.top] - how many non-idle rows to keep.
 * @returns {?object} null when the profile is empty or malformed.
 */
export function summarizeCpuProfile(profile, { top = 30 } = {}) {
    const nodes = Array.isArray(profile?.nodes) ? profile.nodes : null;
    const samples = Array.isArray(profile?.samples) ? profile.samples : null;
    if (!nodes || !samples || samples.length === 0) return null;

    const totalSamples = samples.length;
    const totalTimeUs = Number(profile.endTime) - Number(profile.startTime);

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const hitByNode = new Map();
    for (const id of samples) hitByNode.set(id, (hitByNode.get(id) || 0) + 1);

    // Wall ms attributable to one sample, so selfMs is a TIME rather than a share. Derived from
    // the profile's own start/end rather than the requested interval: V8 may clamp the request,
    // and a summary scaled by a interval that was never honoured is silently wrong.
    const msPerSample = Number.isFinite(totalTimeUs) && totalTimeUs > 0
        ? (totalTimeUs / 1000) / totalSamples
        : 0;

    const rows = [...hitByNode.entries()].map(([id, hits]) => {
        const frame = nodeById.get(id)?.callFrame || {};
        return {
            fn: frame.functionName || '(anonymous)',
            url: String(frame.url || '').replace(/^https?:\/\/[^/]+/, ''),
            line: frame.lineNumber,
            hits,
            selfPct: Number(((hits / totalSamples) * 100).toFixed(2)),
            selfMs: Number((hits * msPerSample).toFixed(3)),
        };
    }).sort((a, b) => b.hits - a.hits);

    const idleHits = rows
        .filter((r) => IDLE_NODE_NAMES.has(r.fn))
        .reduce((acc, r) => acc + r.hits, 0);
    const gcRow = rows.find((r) => r.fn === '(garbage collector)');
    const appRows = rows.filter((r) => !IDLE_NODE_NAMES.has(r.fn));

    // Sum every row matching a target — a function called from several sites appears as several
    // nodes, and reporting only the largest would understate it.
    const targets = {};
    for (const target of CPU_PROFILE_TARGETS) {
        let urls = null;
        if (Array.isArray(target.url)) urls = target.url;
        else if (target.url) urls = [target.url];
        const matched = rows.filter((r) => r.fn === target.fn
            && (!urls || urls.some((u) => r.url.includes(u))));
        targets[target.key] = matched.length === 0 ? null : {
            fn: target.fn,
            nodes: matched.length,
            hits: matched.reduce((acc, r) => acc + r.hits, 0),
            selfPct: Number(matched.reduce((acc, r) => acc + r.selfPct, 0).toFixed(2)),
            selfMs: Number(matched.reduce((acc, r) => acc + r.selfMs, 0).toFixed(3)),
        };
    }

    return {
        totalSamples,
        totalTimeUs: Number.isFinite(totalTimeUs) ? totalTimeUs : null,
        // If this comes back far above what was requested, V8 clamped the sampler and every
        // selfMs above is scaled against a cadence that never happened. Check it before reading.
        effectiveIntervalUs: Number.isFinite(totalTimeUs) && totalTimeUs > 0
            ? Number((totalTimeUs / totalSamples).toFixed(1))
            : null,
        // An ~11 ms frame at a 240 Hz target still idles between frames, so a busyPct near 100
        // means the window caught something other than steady state and the cell is inadmissible.
        busyPct: Number((((totalSamples - idleHits) / totalSamples) * 100).toFixed(1)),
        gcPct: gcRow ? gcRow.selfPct : 0,
        targets,
        top: appRows.slice(0, top),
    };
}

export default summarizeCpuProfile;
