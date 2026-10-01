import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const directory = path.resolve('reports/wolfhour-motion-audit');
const sourceDirectory = path.join(directory, 'baseline-source');
const files = [];
for (const name of readdirSync(sourceDirectory)) {
    if (!name.endsWith('.js')) continue;
    const sourcePath = path.join(sourceDirectory, name);
    let source = readFileSync(sourcePath, 'utf8');
    source = source.replace(/from (['"])(\.\.[^'"]+)\1/g, (_, quote, specifier) => `from ${quote}${path.posix.normalize(`/src/themes/wolfhour/${specifier}`)}${quote}`);
    writeFileSync(sourcePath, source);
    files.push({ path: `baseline-source/${name}`, sha256: createHash('sha256').update(source).digest('hex') });
}
const assetDirectory = path.join(directory, 'baseline-build/assets');
const assets = readdirSync(assetDirectory).map(name => {
    const bytes = readFileSync(path.join(assetDirectory, name));
    return { path: `baseline-build/assets/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
writeFileSync(path.join(directory, 'baseline-manifest.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    description: 'Immutable production artifact of the completed Wolfhour visual overhaul, before the depth and motion audit. This is the previous updated pass, not the pre-overhaul git HEAD.',
    sourceNote: 'Source snapshot retained as a readable companion; compiled asset hashes identify the authoritative A/B artifact.',
    url: 'http://127.0.0.1:4180/reports/wolfhour-overhaul/prototype.html?shipping=1&t=8&quality=High',
    assets,
    source: files,
}, null, 2));
