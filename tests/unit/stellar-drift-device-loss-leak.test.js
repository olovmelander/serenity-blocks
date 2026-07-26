import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SB-15 WebGPU-lane leak regression (dominant leak, ~2.9 MB/toggle before fix).
//
// three's WebGPUBackend already wires `device.lost.then()` -> `renderer.onDeviceLost`
// (three/src/renderers/webgpu/WebGPUBackend.js), and stellar-drift nulls
// renderer.onDeviceLost on teardown, so device-loss recovery is fully covered by
// onDeviceLost alone. An ADDITIONAL app-side `device.lost.then(() => this.handleDeviceLoss())`
// used to be registered in setupRendererResilience — but a .then() reaction cannot be
// detached and device.lost never settles under normal play, so its closure pinned the
// whole theme instance (scene included) on the never-resolving promise for every theme
// activation. Heap snapshots convicted it as the dominant SB-15 WebGPU-lane leak;
// removing it cut the per-toggle growth by ~93% (software-WebGPU A/B, 10 toggles:
// +29.3 MB -> +2.1 MB). These contract checks keep it from creeping back.

const source = readFileSync(
    new URL('../../src/themes/stellar-drift/stellar-drift-theme.js', import.meta.url),
    'utf8',
);

// Anchor on the method DEFINITION (4-space class indent), not call sites or prose
// mentions in comments (which include the tokens we assert against below).
function methodBody(name) {
    const match = source.match(new RegExp(`\\n {4}${name}\\s*\\(`));
    expect(match, `method ${name} not found`).not.toBeNull();
    return source.slice(match.index, match.index + 2500);
}

const stripComments = (s) => s
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('stellar-drift WebGPU device-loss handling (SB-15 leak regression)', () => {
    it('still routes device loss through renderer.onDeviceLost (recovery preserved)', () => {
        const body = methodBody('setupRendererResilience');
        expect(body).toMatch(/this\.renderer\.onDeviceLost\s*=/);
        expect(body).toContain('handleDeviceLoss');
    });

    it('does NOT register a raw device.lost.then() (the leak); relies on onDeviceLost only', () => {
        // Strip comments so the explanatory note (which names the removed pattern) does
        // not trip the guard — we are asserting the CODE no longer registers it.
        const code = stripComments(methodBody('setupRendererResilience'));
        expect(code).not.toMatch(/device\??\.lost/);
        expect(code).not.toMatch(/deviceLostPromise/);
        expect(code).not.toMatch(/\.lost\s*\.\s*then/);
    });

    it('nulls renderer.onDeviceLost on teardown so onDeviceLost cannot outlive the theme', () => {
        const body = methodBody('disposeRendererResources');
        expect(body).toMatch(/this\.renderer\.onDeviceLost\s*=\s*null/);
    });
});
