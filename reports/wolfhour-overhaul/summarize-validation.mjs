import { readFileSync, writeFileSync } from 'node:fs';

const directory = new URL('./', import.meta.url);
const parse = result => JSON.parse(result.content.find(item => item.type === 'text').text.match(/```json\n([\s\S]*?)\n```/)[1]);
const names = [
    'original-final-high', 'reference-final-high', 'reference-final-square',
    'reference-final-combo', 'reference-final-crash', 'reference-final-portrait',
    'reference-final-playground',
];
const captures = Object.fromEntries(names.map(name => {
    const report = JSON.parse(readFileSync(new URL(`${name}.json`, directory), 'utf8'));
    if (report.error) throw new Error(`${name}: ${report.error}`);
    const repeats = ['repeat1', 'repeat2'].map(key => {
        const data = parse(report[key]);
        const content = [...new Set(data.content.map(item => JSON.stringify(item)))].map(item => JSON.parse(item));
        if (content.length !== 1) throw new Error(`${name}: content changed during measurement`);
        return { gpuMs: data.gpuMs, cpuMs: data.cpuMs, frameMs: data.frameMs, content: content[0], memoryBytes: data.stats.memory.total, activeEvents: data.stats.activeEvents };
    });
    const errors = parse(report.errors);
    if (errors.length) throw new Error(`${name}: browser errors`);
    return [name, {
        screenshot: `${name}.png`, createdAt: report.createdAt, viewport: report.viewport,
        url: report.url, quality: report.quality, seed: report.seed, t: report.t,
        runtimeFeatures: report.runtimeFeatures, compiledAssets: report.compiledAssets,
        repeats, errors, console: report.console.content[0].text,
    }];
}));
const original = captures['original-final-high'].repeats;
const revised = captures['reference-final-high'].repeats;
const verification = {
    direction: 'DNKL Wolfhour reference: black sky, fine stars, silver granite walls, dark central valley and layered foreground; a restrained moon and animated gameplay reactions.',
    scope: 'Isolated Wolfhour ambient scene and actual gameplay effect methods. Classic WebGL fallback is preserved. Full game FPS and integrated GPU performance are not measured.',
    instrument: {
        browser: 'Chrome DevTools MCP 1.7.0, isolated headless Chrome, native WebGPU, NVIDIA Ampere',
        baselineRevision: '14b576a1a9f2e7003bc63eaa4d89c66d0767ab92',
        comparison: '1280x720, DPR 1, High, seed 73013, t=8, MSAA, production minified fixtures, runtime single-target post, compute off in both.',
        method: '45 warm frames, then two 180-frame windows. One GPU sample per resolved render timestamp query. Fixed scene content within each window. Browser timestamp quantization limits precision; shared machine load can affect CPU/frame timings.',
    },
    comparison: {
        originalDrawCalls: original[0].content.calls,
        revisedDrawCalls: revised[0].content.calls,
        originalTriangles: original[0].content.triangles,
        revisedTriangles: revised[0].content.triangles,
        gpuMedianMs: { original: original.map(r => r.gpuMs.p50), revised: revised.map(r => r.gpuMs.p50) },
        frameMedianMs: { original: original.map(r => r.frameMs.p50), revised: revised.map(r => r.frameMs.p50) },
    },
    validation: {
        wolfhourUnitTests: '39 passed across 4 files',
        themeLifecycleAudit: 'passed',
        productionBuildAndBootClosure: 'passed',
        typecheck: 'passed',
        lintRatchet: 'passed: 1332 errors against existing 1336-error baseline; no new-module errors',
        visual: 'Screenshots inspected at landscape, square and portrait sizes, including combo and post-impact phases; no browser or WebGPU validation errors.',
    },
    reproduction: {
        original: ['node reports/wolfhour-overhaul/freeze-original.mjs', 'node reports/wolfhour-overhaul/build-original.mjs', 'node reports/wolfhour-overhaul/serve-original.mjs'],
        revised: ['node reports/wolfhour-overhaul/build-prototype.mjs', 'node reports/wolfhour-overhaul/serve-prototype.mjs'],
        capture: 'Set WOLFHOUR_CAPTURE_URL to a recorded URL, WOLFHOUR_CAPTURE_NAME to its name, WOLFHOUR_VIEWPORT to widthxheight, then run node reports/wolfhour-overhaul/capture-original.mjs. Run GPU captures serially.',
        fullCaptureSet: 'With both servers running, node reports/wolfhour-overhaul/capture-final-set.mjs captures all seven cases serially. Then node reports/wolfhour-overhaul/summarize-validation.mjs writes this report.',
        chromeMcp: 'Set WOLFHOUR_MCP_BIN to chrome-devtools-mcp 1.7.0 build/src/bin/chrome-devtools-mcp.js when the local npm cache path is unavailable.',
    },
    captures,
};
writeFileSync(new URL('verification.json', directory), `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify(verification.comparison, null, 2));
