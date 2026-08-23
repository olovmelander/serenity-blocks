/**
 * @fileoverview Unit tests for the GPU per-pass NAMING rules.
 *
 * The board publishes a per-pass GPU split (summary.passes[]) read from three's timestamp pool.
 * The pool keys durations by `r:<frameCalls>:<RenderContext.id>:f<frame>`, and neither half
 * before `:f` identifies a pass: `frameCalls` is the render call's ordinal within the frame, and
 * `RenderContext.id` is a format cache bucket shared by every target with the same attachment
 * state. So all eight bloom targets share one id, and the RCAS RTT shares the SCENE pass's id
 * whenever sceneSamples is 0 — an id-keyed split silently merges unrelated passes.
 *
 * These pin the replacement: names resolved from the render TARGET, which is per-pass. Pure
 * functions over plain objects — no renderer, no GPU, no three instantiation.
 */

import { describe, it, expect } from 'vitest';
import { passLabelFor } from '../../src/rendering/odyssey/composition/odyssey-pass-label-inspector.js';

/** A minimal render-target stand-in. */
function target({
    name = '', width = 1920, height = 1080, type = 1016, depthBuffer = true, samples = 0,
} = {}) {
    return {
        width, height, depthBuffer, samples, texture: { name, type },
    };
}

describe('passLabelFor — pass identity comes from the target, not the uid', () => {
    it('names the canvas composite when there is no render target', () => {
        // RenderPipeline renders its quad with renderTarget null (it forces NoToneMapping and
        // the working colour space first, so three inserts no framebuffer target).
        expect(passLabelFor(null, null, null)).toBe('canvas');
    });

    it('matches the scene pass by OBJECT IDENTITY, not by name', () => {
        // The one pass worth being certain about. PassNode's texture is named 'output', which is
        // far too generic to trust — identity is what makes this rule collision-proof.
        const scenePass = target({ name: 'output' });
        expect(passLabelFor(scenePass, null, scenePass)).toBe('scene');
    });

    it('does not claim an unrelated PassNode is OUR scene pass', () => {
        const ours = target({ name: 'output' });
        const theirs = target({ name: 'output' });
        expect(passLabelFor(theirs, null, ours)).toBe('pass.output');
    });

    it('names each bloom target distinctly even though they share one RenderContext id', () => {
        // This is the whole point: BloomNode creates every target with the same
        // { depthBuffer: false, type: HalfFloatType }, so three buckets them under ONE id.
        const names = [
            'UnrealBloomPass.bright',
            'UnrealBloomPass.h0', 'UnrealBloomPass.v0',
            'UnrealBloomPass.h1', 'UnrealBloomPass.v1',
            'UnrealBloomPass.h2', 'UnrealBloomPass.v2',
        ].map((name) => passLabelFor(target({ name, depthBuffer: false }), null, null));

        expect(names).toEqual([
            'bloom.bright', 'bloom.h0', 'bloom.v0', 'bloom.h1', 'bloom.v1', 'bloom.h2', 'bloom.v2',
        ]);
        expect(new Set(names).size).toBe(names.length); // all distinct
    });

    it('separates the RCAS output from the scene pass despite the shared format bucket', () => {
        const scenePass = target({ name: 'output' });
        const rcas = target({ name: 'SharpenNode.output', depthBuffer: false });
        expect(passLabelFor(rcas, null, scenePass)).toBe('sharpen.rcas');
        expect(passLabelFor(scenePass, null, scenePass)).toBe('scene');
    });

    it('falls back to the quad name when the target carries none', () => {
        // For a full-screen pass the `scene` argument IS the QuadMesh; RTTNode names its quad.
        const quad = { isQuadMesh: true, name: 'someNode [ RTT ]' };
        expect(passLabelFor(target({ name: '' }), quad, null)).toBe('sharpen.rtt');
    });

    it('falls back to a FORMAT descriptor, never to an ordinal', () => {
        // Last resort: still describes something intrinsic to the target rather than its
        // position in the call order, which is the property that made the raw keys useless.
        const label = passLabelFor(
            target({
                name: '', width: 960, height: 540, type: 1016, depthBuffer: false, samples: 4,
            }),
            null,
            null,
        );
        expect(label).toBe('rt:960x540:t1016:-:s4');
        expect(label).not.toMatch(/^r:\d+:\d+$/);
    });

    it('prefers an explicit texture name over the format fallback', () => {
        expect(passLabelFor(target({ name: 'myCustomTarget' }), null, null)).toBe('myCustomTarget');
    });
});
