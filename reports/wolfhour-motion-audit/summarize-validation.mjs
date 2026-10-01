import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const directory = new URL('./', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(`${name}.json`, directory), 'utf8'));
const parse = result => JSON.parse(result.content.find(item => item.type === 'text').text.match(/```json\n([\s\S]*?)\n```/)[1]);
const baseline = read('baseline-motion');
const revised = read('revised-motion');
const firstRevisedLaunch = read('revised-motion-first');
const repeats = report => ['repeat1', 'repeat2'].map(key => {
    const window = report[key];
    if (window.uniqueContent.length !== 1 || window.gpuMs.count !== 180) throw new Error('Invalid motion window');
    return {
        gpuMs: window.gpuMs, cpuUpdateRenderMs: window.cpuUpdateRenderMs,
        content: window.uniqueContent[0], dimensions: window.dimensions,
        startTime: window.startTime, endTime: window.endTime,
    };
});
for (const report of [baseline, revised]) {
    if (report.error || report.errors.length) throw new Error('Motion capture contains errors');
}
const oldWindows = repeats(baseline);
const newWindows = repeats(revised);
const contentMatched = oldWindows.every((old, index) => {
    const current = newWindows[index];
    return old.content.calls === current.content.calls
        && Math.abs(current.content.triangles / old.content.triangles - 1) <= 0.02
        && JSON.stringify(old.dimensions) === JSON.stringify(current.dimensions);
});
if (!contentMatched) throw new Error('Motion comparison does not satisfy the draw/triangle content guard');

const motion = report => {
    const cameraDeltaX = report.after.camera.position[0] - report.before.camera.position[0];
    return {
        cameraDeltaX,
        layers: report.after.layers.map((layer, index) => ({
            name: layer.name,
            cameraRelativeDeltaX: layer.worldPosition[0] - report.before.layers[index].worldPosition[0] - cameraDeltaX,
        })),
    };
};
const names = [
    'revised-idle', 'revised-combo', 'revised-descent', 'revised-impact',
    'revised-left', 'revised-right', 'revised-portrait', 'revised-board', 'revised-wide',
];
const captures = Object.fromEntries(names.map(name => {
    const report = read(name);
    const errors = report.errors ? parse(report.errors) : ['Capture did not finish'];
    if (report.error || errors.length) throw new Error(`${name} contains errors`);
    if (report.compiledAssets.length !== revised.compiledAssets.length
        || report.compiledAssets.some(asset => !revised.compiledAssets.some(measured =>
            asset.sha256 === measured.sha256 && asset.bytes === measured.bytes && asset.url === measured.url))) {
        throw new Error(`${name} did not capture the final measured bundle`);
    }
    return [name, {
        screenshot: `${name}.png`, url: report.url, createdAt: report.createdAt,
        viewport: report.viewport, quality: report.quality, errors,
        activeEvents: parse(report.repeat2).stats.activeEvents,
    }];
}));
const sourceFiles = readdirSync('src/themes/wolfhour').filter(name => name.endsWith('.js'))
    .map(name => path.posix.join('src/themes/wolfhour', name));
sourceFiles.push('src/playground/effects/wolfhour.effect.js', 'reports/wolfhour-overhaul/prototype-fixture.js');
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file,
    createHash('sha256').update(readFileSync(file)).digest('hex'),
]));
const verification = {
    createdAt: new Date().toISOString(),
    direction: 'The supplied Wolfhour cover: silver left wall, shadowed right massif, black central valley and fine stars. Stronger layer depth, natural moon shading and restrained meteor reactions.',
    findings: [
        'The prior orthographic scene translated all layers together, eliminating depth cues. Camera motion now drives distinct sky, moon, fog and mountain responses, with damped pointer movement.',
        'Terrain crest notches were extruded vertically into fabric-like folds. Relief now uses absolute elevation with irregular diagonal crags and broken snow gullies; local texture coordinates prevent swimming.',
        'Subpixel stars could flicker during movement. Derivative-filtered cores conserve light, with faint clustered stars and rare brighter anchors in one instanced draw.',
        'Pooled impact shader ages were stale on reuse. They now reset before the first impact frame; fragments are smaller, dust is restrained and expired shockwaves stop drawing.',
        'Impacts needed the same terrain transform during motion and aspect changes. Landing anchors now follow both layer translation and aspect scaling.',
    ],
    scope: 'Isolated native WebGPU Wolfhour, including actual theme event methods and a playground board proxy. Full-game FPS, iGPU and WebGL fallback appearance were not measured.',
    instrument: {
        browser: 'Chrome DevTools MCP 1.7.0; private headless Chrome profile; NVIDIA Ampere native WebGPU.',
        baseline: 'Frozen completed previous Wolfhour pass, not repository HEAD. See baseline-manifest.json.',
        comparison: '1280x720, DPR1, High, seed73013, production minified fixtures, post enabled, MRT/compute disabled in both; two 180-frame windows from t8 to t11 after45 warm frames each.',
        method: 'One sample per resolved GPU timestamp; CPU includes update and render. Draw calls match exactly and triangle count differs by less than2%. RAF intervals include query synchronization and are not gameplay FPS.',
        limits: 'GPU timestamp buckets are65.536 microseconds. Equal buckets mean difference below resolution, not zero added cost. Capture browsers ran sequentially after build/lint completed; the shared workstation and user-owned development services were not exclusively controlled.',
    },
    performance: {
        contentMatched, baseline: oldWindows, revised: newWindows,
        firstRevisedLaunch: repeats(firstRevisedLaunch),
        interpretation: 'The final repeated GPU medians matched the prior pass. An earlier launch of the same final bundle measured one timestamp bucket higher in both windows, retained here rather than discarded. This is an observed isolated result, not an exclusive-machine or full-game FPS guarantee. Geometry decreased by2400 triangles with22 draws unchanged.',
    },
    motion: { baseline: motion(baseline), revised: motion(revised) },
    validation: {
        unitTests: '53 passed across5 Wolfhour suites, including real camera/parallax integration, terrain-local impact attachment through resize, pooled ages, cleanup, and capped-frame animation timing.',
        scopedEslint: 'Passed for new leaf modules, post and playground effect.',
        repositoryChecks: read('checks'),
        visual: 'All nine final screenshots inspected; zero browser/WebGPU errors. Portrait Low and landscape/ultrawide High, pointer extremes, board proxy, combo, descent and impact.',
    },
    compiledAssets: { baseline: baseline.compiledAssets, revised: revised.compiledAssets },
    sourceHashes,
    captures,
};
writeFileSync(new URL('verification.json', directory), `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify({ performance: verification.performance, motion: verification.motion }, null, 2));
