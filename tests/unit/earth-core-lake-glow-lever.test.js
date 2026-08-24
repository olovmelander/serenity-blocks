/**
 * @fileoverview The lava-lake SPLIT lever — proven live, and proven surgical.
 *
 * WHY IT EXISTS. `?earthCoreNoLake=1` withholds SIX draws, not one: the 360x360 lake plane AND
 * five large additive glow sprites (ambient 120u, inner 70u, three basin coronas 66-84u, all
 * frustumCulled=false, depthWrite=false, AdditiveBlending). So the measured `lakeMs` — 2.228 ms
 * on Lane B at the ch1 entry station, the largest single object cost in the game — is plane PLUS
 * sprite fill, and the split between them was unknown. That matters because the two have
 * OPPOSITE fixes: a cheaper lake shader versus simply cutting sprites.
 * `?earthCoreNoLakeGlows=1` withholds only the sprites, so the plane's share falls out by
 * subtraction inside one cooled session.
 *
 * WHY IT IS TESTED AT ALL. A lever nothing reads reports innocence, not absence: a dead flag
 * makes a differential read EXACTLY ZERO, which is indistinguishable from "this object is free".
 * That has already happened twice in this repo (the dead `odysseyWorldNoHeroes`, and
 * `lake-baked` silently comparing baked against baked). So the flag is proven live by building
 * the environment under it and watching the sprites actually leave the scene graph — and the
 * gpu-split configuration id is pinned to the same flag string so the harness and the chapter
 * cannot drift apart silently.
 *
 * Pattern follows cosmic-expanse-bisect-levers.test.js. No GPU, no renderer.
 */

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEarthCoreEnvironment } from '../../src/rendering/odyssey/chapter-environments/earth-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPLIT = fs.readFileSync(
    path.resolve(here, '../../scripts/odyssey-gpu-split.mjs'),
    'utf8',
);

/** The lake builds a CanvasTexture for its glow sprites; stub the 2D canvas. */
function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({ width: 0, height: 0, getContext: vi.fn(() => context) })),
    });
}

/** Build the chapter with a given URL query — readBisect reads window.location.search. */
function buildWithSearch(search) {
    stubCanvasDocument();
    vi.stubGlobal('window', { location: { search } });
    return createEarthCoreEnvironment({ qualityName: 'High' });
}

/** Drawables actually PARENTED under the lava-floor group (what the GPU would submit). */
function lakeDrawables(group) {
    const floor = group.userData.lavaFloor;
    const out = { meshes: 0, sprites: 0 };
    if (!floor) return out;
    floor.traverse((o) => {
        if (o.isSprite) out.sprites += 1;
        else if (o.isMesh) out.meshes += 1;
    });
    return out;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('earth-core lava-lake split lever', () => {
    it('ships the plane plus five glow sprites — the six draws no-lake bundles', () => {
        const group = buildWithSearch('');
        const { meshes, sprites } = lakeDrawables(group);
        expect(meshes).toBe(1); // the 360x360 lake surface
        expect(sprites).toBe(5); // ambient + inner + three basin coronas
        expect(group.userData.lavaFloor.parent).toBeTruthy(); // actually in the chapter
    });

    it('?earthCoreNoLakeGlows=1 withholds the five sprites and KEEPS the plane', () => {
        const group = buildWithSearch('?earthCoreNoLakeGlows=1');
        const { meshes, sprites } = lakeDrawables(group);
        expect(sprites).toBe(0);
        expect(meshes).toBe(1); // the whole point: the plane still draws
        // The lever must be a five-draw delta against the default build, which is what makes
        // the subtraction lakeMs - lakeGlowsMs mean "the plane".
        const shipped = lakeDrawables(buildWithSearch(''));
        expect(shipped.sprites - sprites).toBe(5);
        expect(shipped.meshes - meshes).toBe(0);
    });

    it('withholds the sprites rather than skipping them, so nothing downstream dangles', () => {
        // Same shape as ?earthCoreNoLake: the objects are BUILT and only left unparented, so the
        // per-frame glow-pulse animation over userData.glows keeps working and the framing
        // test's visibility targets still resolve. A material that never renders never gets a
        // pipeline, so the lever still prices draws + fill + that pipeline.
        const group = buildWithSearch('?earthCoreNoLakeGlows=1');
        expect(group.userData.lavaFloor.userData.glows).toHaveLength(5);
        group.userData.lavaFloor.userData.glows.forEach((sprite) => {
            expect(sprite.parent).toBeNull(); // built, not parented
            expect(sprite.frustumCulled).toBe(false); // the +-1 draw flicker fix is preserved
        });
    });

    it('leaves the rest of the chapter alone — it is a lake lever, not a scene lever', () => {
        const shipped = buildWithSearch('');
        const levered = buildWithSearch('?earthCoreNoLakeGlows=1');
        const count = (g) => {
            let n = 0;
            g.traverse((o) => { if (o.isMesh || o.isSprite || o.isInstancedMesh) n += 1; });
            return n;
        };
        // Exactly five drawables fewer in the WHOLE chapter, not just the lake group.
        expect(count(shipped) - count(levered)).toBe(5);
        expect(levered.userData.magmaCloudCanopy).toBeTruthy();
    });

    it('is independent of the whole-lake lever', () => {
        const noLake = buildWithSearch('?earthCoreNoLake=1');
        // no-lake withholds the entire group, so nothing under it is parented.
        expect(noLake.userData.lavaFloor.parent).toBeNull();
        // ...and the group is still built, so userData consumers are unaffected.
        expect(noLake.userData.lavaFloor.userData.glows).toHaveLength(5);
    });

    it('gpu-split drives the exact flag the chapter reads', () => {
        // The two must never drift: a renamed flag on either side silently produces a zero.
        expect(SPLIT).toMatch(/id:\s*'no-lake-glows',\s*flags:\s*\{\s*earthCoreNoLakeGlows:\s*'1'/);
        expect(SPLIT).toMatch(/id:\s*'no-lake',\s*flags:\s*\{\s*earthCoreNoLake:\s*'1'/);
        // And the split must publish the two figures the trio exists to produce.
        expect(SPLIT).toMatch(/lakeGlowsMs:/);
        expect(SPLIT).toMatch(/lakePlaneMs:/);
    });
});
