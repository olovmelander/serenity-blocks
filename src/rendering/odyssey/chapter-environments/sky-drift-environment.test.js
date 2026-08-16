import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    createSkyDriftEnvironment,
    updateSkyDriftEnvironment,
    resolveSkyDriftAuroraExitOpacity,
} from './sky-drift.js';
import { CANONICAL_HERO_MOUNTAIN_SPEC_IDS } from './shared/canonical-mountain-range.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';

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
        createElement: vi.fn(() => ({
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        })),
    });
}

describe('Sky Drift chapter environment (creative plan ch5)', () => {
    it('mounts the summit ring, lenticular landmark, noctilucent veil, and FG layers', () => {
        stubCanvasDocument();

        const group = createSkyDriftEnvironment({ particleCount: 120 });

        expect(group.userData.summitRing?.name).toBe('receding-summit-ring');
        // 3 hero peaks + 2 far-range flank silhouettes (enabled 2026-08 in all L5 hosts).
        expect(group.userData.summitRing.children.length).toBe(4);
        expect(group.userData.summitRing.userData.canonicalMountainRange.sourceChapter)
            .toBe(4);
        expect(group.userData.summitRing.userData.specIds)
            .toEqual([...CANONICAL_HERO_MOUNTAIN_SPEC_IDS, 'ch4-far-left']);
        expect(group.userData.summitRing.userData.canonicalMountainRange.includesFarRange)
            .toBe(true);
        group.userData.summitRingOpacityUniforms.forEach((target) => {
            expect(target.__odysseyBaseOpacity).toBe(1);
        });
        expect(group.userData.lenticular?.name).toBe('lenticular-landmark');
        expect(group.userData.noctilucent?.name).toBe('noctilucent-veil');
        expect(group.userData.iceCrystals?.name).toBe('sky-drift-ice-crystals');
        // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): the near-black DARK WISPS are removed (a
        // night motif), and Ch5 now mounts the shared CLOUD-SEA DECK (landscape lever L1) so the
        // sunlit sea persists below across the 4→5 handoff instead of the floor vanishing.
        expect(group.userData.darkWisps).toBeUndefined();
        expect(group.userData.cloudSea).toBeTruthy();
    });

    it('stays bright daylight (dusk script removed) while keeping the summit ring visible until passed', () => {
        stubCanvasDocument();

        const group = createSkyDriftEnvironment({ particleCount: 120 });
        const { uniforms } = group.userData;
        const tStart = group.userData.chapterTStart;
        const tEnd = group.userData.chapterTEnd;
        expect(tEnd).toBeGreaterThan(tStart);

        // Entry: dusk 0 — warm sun key alive, summit ring at full presence.
        updateSkyDriftEnvironment(group, 0.016, 1.0, null, tStart, null);
        expect(uniforms.uDusk.value).toBe(0);
        const entrySunIntensity = group.userData.sunKey.intensity;
        expect(entrySunIntensity).toBeGreaterThan(0.3);
        const ringBaseY = group.userData.summitRing.userData.baseY;

        // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): the dusk→night script is REMOVED — Ch5 is now
        // the bright daylight cloud-sea payoff. uDusk is CAPPED low, the warm sun key stays ALIVE the
        // whole chapter, and the glows no longer shift aurora-green. The summit ring is still
        // camera-pass gated (visible until passed), which is what this test now guards.
        updateSkyDriftEnvironment(group, 0.016, 2.0, null, tEnd, null);
        expect(uniforms.uDusk.value).toBeLessThanOrEqual(0.12); // capped daylight, never a full dusk
        expect(group.userData.sunKey.intensity).toBeGreaterThan(0.3); // sun stays alive
        expect(group.userData.summitRing.position.y).toBe(ringBaseY);
        (group.userData.summitRingOpacityUniforms || []).forEach((target) => {
            expect(target.value).toBeCloseTo(target.__odysseyBaseOpacity ?? 0.9, 5);
        });

        // Even after the Sky->Space boundary, a not-yet-passed summit must remain fully
        // readable. Aurora recedes here, but the mountain ring is camera-pass gated only.
        // ⚠️ ABSOLUTE, not a fraction of the chapter. This was `(tEnd - tStart) * 0.16`, which
        // meant 0.024 past the boundary when chapter 5 spanned 0.148. Wave 1A's ascent widened
        // chapter 5 to 0.371, so the same fraction now lands 0.059 past it — deep into Space,
        // where the ring has legitimately receded because it is camera-pass gated. The claim
        // is "just after the boundary the summit is still readable", so say that in absolute
        // progress and it keeps meaning it.
        const afterBoundary = tEnd + 0.024;
        updateSkyDriftEnvironment(group, 0.016, 2.5, null, afterBoundary, null);
        (group.userData.summitRingOpacityUniforms || []).forEach((target) => {
            expect(target.value).toBeCloseTo(target.__odysseyBaseOpacity ?? 0.9, 5);
        });
    });

    it('holds the 5→6 aurora past the boundary, then dissolves it across Space (no pop)', () => {
        const positions = getActiveOdysseyChapterPositions();
        const ch5Start = positions[4];
        const ch6Start = positions[5];
        const ch7Start = positions[6];
        const ch5Span = ch6Start - ch5Start;
        const spaceSpan = ch7Start - ch6Start;

        // The world-locked curtain is never physically passed in Ch6, so it stays FULLY
        // present through Ch5 and HELD past the boundary (no early fade) — then dissolves.
        expect(resolveSkyDriftAuroraExitOpacity(ch5Start + ch5Span * 0.5, positions)).toBe(1);
        expect(resolveSkyDriftAuroraExitOpacity(ch6Start, positions)).toBe(1);
        expect(resolveSkyDriftAuroraExitOpacity(ch6Start + spaceSpan * 0.3, positions)).toBe(1);

        // Then it eases out across the long tail — partial mid-ease, gone by ~85% of Space.
        const easing = resolveSkyDriftAuroraExitOpacity(ch6Start + spaceSpan * 0.6, positions);
        expect(easing).toBeGreaterThan(0);
        expect(easing).toBeLessThan(1);
        expect(resolveSkyDriftAuroraExitOpacity(ch6Start + spaceSpan * 0.85, positions)).toBeCloseTo(0, 5);

        // Monotonic dissolve across the tail (a smooth recede, never a flicker/pop).
        let prev = 1.0001;
        for (let f = 0.4; f <= 0.9 + 1e-9; f += 0.1) {
            const v = resolveSkyDriftAuroraExitOpacity(ch6Start + spaceSpan * f, positions);
            expect(v).toBeLessThanOrEqual(prev + 1e-9);
            prev = v;
        }
    });

    it('keeps the summit ring opaque until the peak is genuinely behind the camera', () => {
        stubCanvasDocument();

        const group = createSkyDriftEnvironment({ particleCount: 120 });
        group.updateMatrixWorld(true);
        const target = new THREE.Vector3();
        const focus = group.userData.summitRing.getObjectByName('ch4-center-hero');
        focus.getWorldPosition(target);
        const cameraPosition = target.clone().add(new THREE.Vector3(0, 0, 100));
        const shallowBehindForward = new THREE.Vector3(
            Math.sqrt(1 - (0.18 * 0.18)),
            0,
            0.18,
        );
        const camera = {
            getWorldPosition(out) {
                out.copy(cameraPosition);
                return out;
            },
            getWorldDirection(out) {
                out.copy(shallowBehindForward);
                return out;
            },
        };

        updateSkyDriftEnvironment(group, 0.016, 2.5, camera, group.userData.chapterTEnd, null);

        (group.userData.summitRingOpacityUniforms || []).forEach((targetUniform) => {
            expect(targetUniform.value)
                .toBeCloseTo(targetUniform.__odysseyBaseOpacity ?? 1, 5);
        });
    });
});
