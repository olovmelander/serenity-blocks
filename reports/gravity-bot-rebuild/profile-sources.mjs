// Resolve Chromium's sampled function locations against the exact packaged JS.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { join } from 'node:path';

const [eventsFile, build, mappedBuild, output] = process.argv.slice(2);
if (!output) throw Error('Expected frame-profile events, the recorded build, a build with hidden source maps, and an output file');

const events = JSON.parse(readFileSync(eventsFile, 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
for (const dir of [build, mappedBuild]) {
    if (sha256(readFileSync(join(dir, 'manifest.json'))) !== events.buildManifestSha256) {
        throw Error('The renderer profile and build manifest differ in ' + dir);
    }
}

const sources = {};
const chunks = {};
const maps = new Map();
function sourceFor(location) {
    const match = / ([^\s/\\]+\.js):(\d+):(\d+)$/.exec(location);
    if (!match) return;
    const [, chunk, line, column] = match;
    if (!maps.has(chunk)) {
        const original = join(build, 'assets', chunk);
        if (!existsSync(original)) return;
        const identical = join(mappedBuild, 'assets', chunk);
        const bytes = readFileSync(original);
        if (!bytes.equals(readFileSync(identical))) throw Error('Packaged JavaScript differs in ' + chunk);
        chunks[chunk] = sha256(bytes);
        maps.set(chunk, new SourceMap(JSON.parse(readFileSync(identical + '.map', 'utf8'))));
    }
    const entry = maps.get(chunk).findEntry(Number(line) - 1, Number(column) - 1);
    const source = entry?.originalSource?.replaceAll('\\', '/').match(/(?:^|\/)((?:src|node_modules)\/.+)$/)?.[1];
    if (source) {
        sources[location] = { file: source, line: entry.originalLine + 1, column: entry.originalColumn + 1, name: entry.name };
    }
}

const windows = [...events.events, ...events.longestDisplayIntervals];
for (const update of events.wholeUpdates) windows.push(...Object.values(update.windows));
const locations = new Set(windows.flatMap(window => Object.keys(window.sampledLocations)));
for (const location of locations) sourceFor(location);
writeFileSync(output, JSON.stringify({ manifest: events.buildManifestSha256, chunks, sources }, null, 2), { flag: 'wx' });
