import { describe, expect, it } from 'vitest';
import { OdysseyPathRenderer } from './OdysseyPathRenderer.js';
import { getOdysseyPathCurve, getActiveOdysseyChapterPositions } from './path-utils.js';

describe('Odyssey chapter markers', () => {
    it('builds self-lit marker materials that satisfy the seam animation contract', () => {
        // Regression guard: updateChapterTransition writes material.emissive.copy(...)
        // and material.emissiveIntensity on EVERY marker each frame, so the marker
        // material must expose both (a MeshBasicMaterial here crashes Odyssey boot
        // during the journey warm-up replay). It must also be self-lit — several
        // chapters run with no local lights, so the visible read has to come from the
        // emissive term, never the lit body color (the "unlit black torus" bug).
        const added = [];
        const sceneStub = { add: (obj) => added.push(obj) };
        const renderer = new OdysseyPathRenderer(sceneStub);
        renderer.pathCurve = getOdysseyPathCurve();

        renderer.createChapterMarkers(getActiveOdysseyChapterPositions());

        expect(renderer.chapterMarkers.length).toBeGreaterThan(0);
        renderer.chapterMarkers.forEach((ring) => {
            expect(typeof ring.material.emissive?.copy).toBe('function');
            expect(typeof ring.material.emissiveIntensity).toBe('number');
            // Self-lit: the chapter identity lives in emissive, the body stays black.
            expect(ring.material.emissive.getHex()).not.toBe(0x000000);
            expect(ring.material.color.getHex()).toBe(0x000000);
        });
    });
});
