import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createSkyDriftEnvironment,
    updateSkyDriftEnvironment,
    resolveSkyDriftAuroraExitOpacity,
} from './sky-drift.js';
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
        expect(group.userData.summitRing.children.length).toBe(2);
        expect(group.userData.lenticular?.name).toBe('lenticular-landmark');
        expect(group.userData.noctilucent?.name).toBe('noctilucent-veil');
        expect(group.userData.iceCrystals?.name).toBe('sky-drift-ice-crystals');
        expect(group.userData.darkWisps?.name).toBe('sky-drift-dark-wisps');
    });

    it('drives the dusk script: sun dies, summit ring recedes, lights go auroral', () => {
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

        // Late chapter: dusk ≈ 1 — the sun key is dead, the ring sank and faded, and
        // the point glows have shifted toward aurora green (g channel dominates).
        updateSkyDriftEnvironment(group, 0.016, 2.0, null, tEnd, null);
        expect(uniforms.uDusk.value).toBeCloseTo(1, 5);
        expect(group.userData.sunKey.intensity).toBeCloseTo(0, 5);
        expect(group.userData.summitRing.position.y).toBeLessThan(ringBaseY);
        (group.userData.summitRingOpacityUniforms || []).forEach((target) => {
            expect(target.value).toBeCloseTo(0, 5);
        });
        expect(group.userData.purpleGlow.color.g).toBeGreaterThan(group.userData.purpleGlow.color.b);
    });

    it('narrows the 5→6 aurora recede to the final stretch', () => {
        const positions = getActiveOdysseyChapterPositions();
        const ch5Start = positions[4];
        const ch6Start = positions[5];
        const span = ch6Start - ch5Start;

        // Mid-chapter and at 80% (the corona climax) the curtain is fully present —
        // the recede band is only the last ~15%.
        expect(resolveSkyDriftAuroraExitOpacity(ch5Start + span * 0.5, positions)).toBe(1);
        expect(resolveSkyDriftAuroraExitOpacity(ch5Start + span * 0.8, positions)).toBe(1);
        const late = resolveSkyDriftAuroraExitOpacity(ch5Start + span * 0.95, positions);
        expect(late).toBeGreaterThan(0);
        expect(late).toBeLessThan(1);
        expect(resolveSkyDriftAuroraExitOpacity(ch6Start, positions)).toBeCloseTo(0, 5);
    });
});
