import { readFileSync } from 'node:fs';
import {
    describe, expect, it, vi,
} from 'vitest';

import { disposeComposerPasses } from '../../src/themes/shared/composer-dispose.js';

// SB-15 WebGL-lane residual: three r181's EffectComposer.dispose() frees only
// its two render targets + internal copyPass and never iterates this.passes, so
// a theme's WebGL-fallback post stack (RenderPass, UnrealBloomPass, ShaderPass…)
// leaks in full on every activation unless the passes are disposed explicitly.
// disposeComposerPasses() closes that gap; these tests pin both its behaviour
// and the upstream contract that keeps it necessary.

describe('disposeComposerPasses()', () => {
    it('disposes every pass held by the composer', () => {
        const passes = [
            { dispose: vi.fn() },
            { dispose: vi.fn() },
            { dispose: vi.fn() },
        ];
        disposeComposerPasses({ passes });
        for (const pass of passes) {
            expect(pass.dispose).toHaveBeenCalledTimes(1);
        }
    });

    it('keeps disposing later passes after one throws', () => {
        const good = { dispose: vi.fn() };
        const bad = { dispose: vi.fn(() => { throw new Error('boom'); }) };
        const alsoGood = { dispose: vi.fn() };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(() => disposeComposerPasses({ passes: [good, bad, alsoGood] })).not.toThrow();

        expect(good.dispose).toHaveBeenCalledTimes(1);
        expect(bad.dispose).toHaveBeenCalledTimes(1);
        expect(alsoGood.dispose).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('tolerates passes without a dispose method (base Pass.dispose is a no-op)', () => {
        const withDispose = { dispose: vi.fn() };
        expect(() => disposeComposerPasses({ passes: [{}, null, withDispose] })).not.toThrow();
        expect(withDispose.dispose).toHaveBeenCalledTimes(1);
    });

    it('is null-safe and tolerant of a passless composer', () => {
        expect(() => disposeComposerPasses(null)).not.toThrow();
        expect(() => disposeComposerPasses(undefined)).not.toThrow();
        expect(() => disposeComposerPasses({})).not.toThrow();
        expect(() => disposeComposerPasses({ passes: null })).not.toThrow();
        expect(() => disposeComposerPasses({ passes: 'nope' })).not.toThrow();
    });
});

describe('three EffectComposer.dispose() contract (SB-15 WebGL-lane workaround)', () => {
    const composerSource = readFileSync(
        new URL('../../node_modules/three/examples/jsm/postprocessing/EffectComposer.js', import.meta.url),
        'utf8',
    );

    it('EffectComposer.dispose() still omits pass disposal (else the helper is redundant)', () => {
        const disposeIdx = composerSource.indexOf('\tdispose()');
        expect(disposeIdx).toBeGreaterThan(-1);
        const disposeBody = composerSource.slice(disposeIdx, composerSource.indexOf('\t}', disposeIdx));
        // If upstream starts iterating this.passes in dispose(), the workaround
        // double-disposes — fail loudly so it gets retired deliberately.
        if (/this\.passes/.test(disposeBody)) {
            throw new Error(
                "three's EffectComposer.dispose() now iterates this.passes — retire "
                + 'disposeComposerPasses (src/themes/shared/composer-dispose.js) and this contract test.',
            );
        }
    });
});

describe('stellar-drift wires the WebGL-lane pass disposal (SB-15)', () => {
    const themeSource = readFileSync(
        new URL('../../src/themes/stellar-drift/stellar-drift-theme.js', import.meta.url),
        'utf8',
    );

    it('imports and calls disposeComposerPasses before composer.dispose()', () => {
        expect(themeSource).toContain("import { disposeComposerPasses } from '../shared/composer-dispose.js'");
        const callIdx = themeSource.indexOf('disposeComposerPasses(this.composer)');
        const disposeIdx = themeSource.indexOf('this.composer.dispose?.()');
        expect(callIdx).toBeGreaterThan(-1);
        expect(disposeIdx).toBeGreaterThan(callIdx);
    });
});
