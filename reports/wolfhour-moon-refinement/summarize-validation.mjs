import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const directory = new URL('./', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(`${name}.json`, directory), 'utf8'));
const parse = result => JSON.parse(result.content.find(item => item.type === 'text').text.match(/```json\n([\s\S]*?)\n```/)[1]);
const motion = read('moon-motion');
if (motion.error || motion.errors.length) throw new Error('Motion capture failed');
const moon = pose => pose.layers.find(layer => layer.name === 'Wolfhour moon');
if (JSON.stringify(moon(motion.before).localRotation) === JSON.stringify(moon(motion.after).localRotation)) {
    throw new Error('The shipping lunar rotation did not animate');
}
const names = ['playground-moon-t8', 'moon-idle-t8', 'moon-idle-t32', 'moon-late-corona', 'moon-portrait'];
const captures = Object.fromEntries(names.map(name => {
    const report = read(name);
    if (report.error || parse(report.errors).length) throw new Error(`${name} contains browser errors`);
    if (!name.startsWith('playground') && report.compiledAssets[0].sha256 !== motion.compiledAssets[0].sha256) {
        throw new Error(`${name} does not match the final bundle`);
    }
    return [name, { screenshot: `${name}.png`, url: report.url, viewport: report.viewport, errors: [] }];
}));
const sourceFiles = [
    'src/themes/wolfhour/wolfhour-composition.js',
    'src/themes/wolfhour/wolfhour-sky.js',
    'src/themes/wolfhour/wolfhour-theme.js',
];
const verification = {
    createdAt: new Date().toISOString(),
    change: '25% larger lunar diameter at every aspect. Bounded slow libration, a gently moving light direction, subtle independent ambient brightness, and drifting corona noise. Event pulse strength remains owned by the gameplay director.',
    rendering: 'Reuses the existing sphere, halo, moon texture and noise texture. No new draws, geometry, textures or post passes. The larger disk and halo cover more pixels.',
    visual: 'Playground screenshot inspected before guarding the legacy theme rotation. Final shipping snapshots inspected at t8 and t32, late event halo near the top edge, and portrait Low. No browser/WebGPU errors.',
    checks: read('checks'),
    productionFixtureBuild: 'Passed with existing mixed-import and chunk-size warnings.',
    motion: { before: moon(motion.before), after: moon(motion.after) },
    measuredWindows: ['repeat1', 'repeat2'].map(key => ({
        gpuMs: motion[key].gpuMs,
        cpuUpdateRenderMs: motion[key].cpuUpdateRenderMs,
        content: motion[key].uniqueContent,
    })),
    measurementScope: 'Isolated shipping WebGPU theme, 1280x720 DPR1 High on NVIDIA Ampere. Two 180-frame t8-to-t11 windows, each after45 warm frames; one sample per resolved query. GPU medians remain in the prior pass\'s 0.196608ms bucket with22 draws and119315 triangles. Shared workstation CPU timings vary; this is not a full-game FPS guarantee.',
    compiledAssets: motion.compiledAssets,
    sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])),
    captures,
};
writeFileSync(new URL('verification.json', directory), `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify({ moon: verification.motion, windows: verification.measuredWindows }, null, 2));
