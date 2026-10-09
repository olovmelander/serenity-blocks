/**
 * The playground's profiling switches (src/playground/README.md): `profile=1` collects a bounded
 * window of samples behind window.__PLAYGROUND__.profile, and GPU timestamp queries are a second,
 * explicit opt-in (`trackTimestamp=1`) that does nothing without it. A plain playground session
 * never pays for either.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const playgroundSource = readFileSync(
    new URL('../../src/playground/main.js', import.meta.url),
    'utf8',
);
const playgroundReadme = readFileSync(
    new URL('../../src/playground/README.md', import.meta.url),
    'utf8',
);

describe('playground profiling contract', () => {
    it('keeps GPU timestamp queries explicit and opt-in in the playground', () => {
        expect(playgroundReadme).toContain('`trackTimestamp=1`');
        expect(playgroundReadme).toContain('`profile=1`');
        expect(playgroundSource).toContain(
            'const trackTimestamp = profileEnabled && timestampRequested;',
        );
        expect(playgroundSource).toContain('if (profileEnabled) resetProfile();');
        expect(playgroundSource).toContain(
            'new THREE.WebGPURenderer({ antialias: true, forceWebGL, trackTimestamp })',
        );
        expect(playgroundSource).toContain("renderer.resolveTimestampsAsync('render')");
        expect(playgroundSource).toContain('profile: {');
        expect(playgroundSource).toContain('snapshot: profileSnapshot');
    });
});
