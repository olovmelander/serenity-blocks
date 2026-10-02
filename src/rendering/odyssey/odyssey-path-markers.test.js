import { describe, expect, it } from 'vitest';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import {
    getActiveOdysseyChapterPositions,
    getActiveOdysseyPathData,
} from './path-utils.js';

/**
 * CHAPTER THRESHOLDS, FOLDED INTO THE RIBBON (2026-10 seamless pass).
 *
 * This file used to pin the eight lit torus marker rings (MeshStandardMaterial with a black
 * body and the chapter colour in emissive, animated every frame by updateChapterTransition).
 * Those rings are gone: the thresholds are two collars drawn by the ribbon shader itself at
 * each interior boundary. The new intent pinned here:
 *   - the path draws exactly two meshes (body + haze) and no marker meshes at all,
 *   - nothing in the path renderer is a LIT material (lit pipelines depend on the scene's
 *     per-chapter light set — the rings were the only lit pipeline in the ribbon/nodes),
 *   - every interior chapter boundary reaches the shader as a threshold position,
 *   - the seam animation drives uniforms only (ADR-0020: no material state flips).
 */
function buildRenderer() {
    const added = [];
    const sceneStub = {
        add: (obj) => added.push(obj),
        remove: (obj) => {
            const i = added.indexOf(obj);
            if (i >= 0) added.splice(i, 1);
        },
    };
    const renderer = new OdysseyPathRenderer(sceneStub, { aaa: true });
    return { renderer, added };
}

describe('Odyssey chapter thresholds (folded into the ribbon shader)', () => {
    it('builds the ribbon as two unlit meshes and no marker meshes', async () => {
        const { renderer, added } = buildRenderer();
        await renderer.buildPath(getActiveOdysseyPathData());

        expect(renderer.chapterMarkers).toEqual([]);
        expect(added).toHaveLength(2);
        expect(added.map((mesh) => mesh.name).sort()).toEqual([
            'odyssey-path-glow-tsl',
            'odyssey-path-outer-tsl',
        ]);
        added.forEach((mesh) => {
            expect(mesh.material.isNodeMaterial).toBe(true);
            // Unlit only: the basic node material's output is its diffuse colour (its
            // `lights` flag only routes that through BasicLightingModel), never a lit BRDF —
            // no Standard/Physical/Lambert/Phong material, no emissive/roughness slots.
            expect(mesh.material.type).toBe('MeshBasicNodeMaterial');
            expect(mesh.material.isMeshStandardMaterial || mesh.material.isMeshStandardNodeMaterial).toBeFalsy();
            expect('roughness' in mesh.material).toBe(false);
        });
    });

    it('hands every interior chapter boundary to the shader as a threshold', async () => {
        const { renderer } = buildRenderer();
        await renderer.buildPath(getActiveOdysseyPathData());
        const positions = getActiveOdysseyChapterPositions();
        const bounds = renderer._chapterUniforms.uBounds.map((u) => u.value);
        for (let k = 1; k < 8; k += 1) {
            expect(bounds[k]).toBeCloseTo(positions[k], 6);
        }
    });

    it('drives the seam crossing through uniforms only', async () => {
        const { renderer, added } = buildRenderer();
        await renderer.buildPath(getActiveOdysseyPathData());
        const before = added.map((mesh) => ({
            transparent: mesh.material.transparent,
            side: mesh.material.side,
            blending: mesh.material.blending,
        }));

        renderer.setSeamPhase({
            boundaryId: '4-5',
            fromChapter: 4,
            toChapter: 5,
            boundaryPosition: 0.3489,
            seamWidth: 0.0443,
            seamPhase: 0,
            envelope: 1,
        });
        renderer.update(1 / 60);

        const outer = renderer._outerUniforms;
        expect(outer.uTransitionMix.value).toBe(1);
        expect(outer.uTransitionHead.value).toBeCloseTo(0.3489, 6);
        expect(renderer._glowUniforms.uTransitionMix.value).toBe(1);
        added.forEach((mesh, i) => {
            expect(mesh.material.transparent).toBe(before[i].transparent);
            expect(mesh.material.side).toBe(before[i].side);
            expect(mesh.material.blending).toBe(before[i].blending);
        });

        renderer.clearSeamPhase();
        renderer.update(1 / 60);
        expect(outer.uTransitionMix.value).toBe(0);
    });
});
