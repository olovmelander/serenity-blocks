import * as THREE from 'three/webgpu';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { getActiveOdysseyChapterPositions } from './path-utils.js';
import { ChapterEnvironmentManager } from './ChapterEnvironmentManager.js';
import { deriveOdysseyChapterPositions } from '../../core/odyssey/data/odyssey-layout.js';

describe('ChapterEnvironmentManager atmosphere seams', () => {
    const chapterPositions = [0, 0.13, 0.21, 0.36, 0.5, 0.65, 0.81, 0.94, 1];

    // WAVE 0.3 (2026-08): this used to assert the alpine BRIDGE MIDPOINT (fog 0x638699 at
    // density 0.0024, sky 0x527da2). Ch3 and Ch4 now carry byte-identical fog (0xbcd8ec) and
    // sky (0x5aa8e0) after the daylight re-palette, so that midpoint forced a 3.0x luminance
    // dip and a 2.18x density spike over 196u and then undid it. The wide window is kept; the
    // dip is gone. The guard is now the INVARIANT rather than the numbers: crossing the seam
    // may never take the atmosphere outside the range spanned by its own two endpoints.
    it('never darkens or thickens the atmosphere beyond its own endpoints across the 3-4 seam', () => {
        const scene = new THREE.Scene();
        const renderer = { setClearColor: vi.fn() };
        const manager = new ChapterEnvironmentManager(scene, renderer, { chapterPositions });

        const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const boundary = chapterPositions[3];
        const samples = [];
        for (let i = 0; i <= 40; i += 1) {
            const p = boundary - 0.055 + (0.11 * (i / 40));
            manager.updateGlobalEnvironment(p);
            samples.push({
                p,
                fogLuma: luma(scene.fog.color),
                density: scene.fog.density,
            });
        }

        manager.updateGlobalEnvironment(boundary - 0.055);
        const startLuma = luma(scene.fog.color);
        const startDensity = scene.fog.density;
        manager.updateGlobalEnvironment(boundary + 0.055);
        const endLuma = luma(scene.fog.color);
        const endDensity = scene.fog.density;

        const loLuma = Math.min(startLuma, endLuma);
        const hiLuma = Math.max(startLuma, endLuma);
        const loDens = Math.min(startDensity, endDensity);
        const hiDens = Math.max(startDensity, endDensity);

        samples.forEach((s) => {
            expect(s.fogLuma).toBeGreaterThanOrEqual(loLuma - 1e-4);
            expect(s.fogLuma).toBeLessThanOrEqual(hiLuma + 1e-4);
            expect(s.density).toBeGreaterThanOrEqual(loDens - 1e-9);
            expect(s.density).toBeLessThanOrEqual(hiDens + 1e-9);
        });

        // Falsification: the deleted midpoint (0x638699 @ 0.0024) violated both bounds.
        const bridgeLuma = luma(new THREE.Color(0x638699));
        expect(bridgeLuma).toBeLessThan(loLuma - 0.05);
        expect(0.0024).toBeGreaterThan(hiDens);
        expect(renderer.setClearColor).toHaveBeenCalled();
    });
});

describe('ChapterEnvironmentManager 5-6 earth-at-summit ignite', () => {
    // THE LIVE LAYOUT IS DERIVED, NOT A LITERAL (corrected 2026-08-13). This array was a
    // hand-copied PRE-Phase-2 constant claiming ch4 starts at 0.389 and ch5 at 0.556; the
    // shipped boot derives 0.352 and 0.500, because LEVEL_PHASE2_OVERRIDES re-chapters five
    // levels (20/21 into ch4, 28/29/30 into ch5) after the base literals are written, moving
    // each chapter's opening level. The stale copy contradicted the game's own capture
    // manifests and cost a plan a day of ambiguity, so the test now imports the derivation
    // instead of restating it — a literal here can only ever drift again.
    const chapterPositions = deriveOdysseyChapterPositions();
    const makeManager = () => new ChapterEnvironmentManager(
        new THREE.Scene(),
        { setClearColor: vi.fn() },
        { chapterPositions },
    );

    it('ignites chapter 6 before the boundary so the earth can read against daylight', () => {
        const manager = makeManager();

        // Early Ch5: nothing yet — Space must not be present while the player is still
        // climbing toward the summit. Sample moved 0.58 -> 0.52 with the layout correction
        // above: under the stale array (ch5 starting 0.556) 0.58 was 16% into the chapter and
        // genuinely "early"; under the derived one (ch5 = 0.500-0.648) it is 54% in and clears
        // the 0.5814 ignite start by 0.0014 — the assertion would have passed while no longer
        // testing what it says. 0.52 is 14% in, which is what "early Ch5" means here.
        // DERIVED, not literal. Every p here dated from the pre-ascent layout (ch5 0.500-0.648).
        // Wave 1A re-spaced chapter 5 to 0.3692-0.7401, so the old literals land in different
        // parts of the ignite entirely. The claims are about WHERE IN CHAPTER 5 the boost sits,
        // so express them that way and they survive the next re-layout too.
        const cp = getActiveOdysseyChapterPositions();
        const at = (f) => cp[4] + (cp[5] - cp[4]) * f;
        expect(manager._earthIgniteBoost(at(0.14))).toBe(0);
        // Rising as the camera crests...
        expect(manager._earthIgniteBoost(at(0.68))).toBeGreaterThan(0);
        // ...and SATURATED well before the boundary, so it does not compound with the
        // earth's own reveal ramp (which would leave the planet reaching full opacity
        // only at the boundary, exactly when the sky starts going dark).
        expect(manager._earthIgniteBoost(at(0.97))).toBe(1);
        expect(manager._earthIgniteBoost(cp[5] - 0.0005)).toBe(1);
    });

    it('releases the boost once the normal crossfade has taken over', () => {
        const manager = makeManager();

        // Held through the ecotone (which completes ~6% into the Space span) so the
        // release is a no-op rather than a dip...
        // Derived for the same reason as above: these are "just past the boundary" and
        // "well into space", not the specific numbers the old layout happened to give them.
        // Wave 1C finished the derivation: the old +0.004/+0.012 were absolute p offsets,
        // and the flyby re-map shrank the Space span in p until +0.012 fell past the 10%
        // hold band while meaning the same world position. Probe as span fractions — 8%
        // sits after the ecotone completes (~6%) and inside the hold (10%), which is the
        // exact claim this test makes.
        const cp2 = getActiveOdysseyChapterPositions();
        const spaceSpan = cp2[6] - cp2[5];
        expect(manager._earthIgniteBoost(cp2[5] + spaceSpan * 0.03)).toBe(1);
        expect(manager._earthIgniteBoost(cp2[5] + spaceSpan * 0.08)).toBe(1);
        // ...then gone, so chapter 6 can never be pinned visible across 7 and 8.
        expect(manager._earthIgniteBoost(cp2[6])).toBe(0);
        expect(manager._earthIgniteBoost(cp2[7])).toBe(0);
        expect(manager._earthIgniteBoost(0.99)).toBe(0);
    });

    it('is inert without a resolved layout', () => {
        const manager = new ChapterEnvironmentManager(
            new THREE.Scene(),
            { setClearColor: vi.fn() },
            { chapterPositions: [0, 1] },
        );
        expect(manager._earthIgniteBoost(0.62)).toBe(0);
    });

    it('only boosts chapter 6 at the 5-6 seam', () => {
        const manager = makeManager();
        // DERIVED. p=0.62 was inside the ignite under the pre-ascent layout; after Wave 1A it
        // is only 68% of the way through a much longer chapter 5 and the boost has not
        // saturated there. Ask for a progress the boost is definitely AT, so the test measures
        // "which chapter gets boosted" rather than "is 0.62 still a good number".
        const cp = getActiveOdysseyChapterPositions();
        const saturated = cp[5] - 0.0005;
        [1, 2, 3, 4, 5, 7].forEach((chapterId) => {
            expect(manager._seamInBoostFor(chapterId, saturated)).toBe(0);
        });
        expect(manager._seamInBoostFor(6, saturated)).toBe(1);
    });
});
