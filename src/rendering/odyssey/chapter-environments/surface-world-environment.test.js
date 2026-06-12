import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createSurfaceWorldEnvironment,
    updateSurfaceWorldEnvironment,
    resolveSurfaceWorldEntryRampState,
} from './surface-world.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        createLinearGradient: vi.fn(() => gradient),
        quadraticCurveTo: vi.fn(),
        moveTo: vi.fn(),
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

describe('Surface World chapter environment (creative plan ch3)', () => {
    it('mounts the cabin, foreground pass-by layer, spruce stands, and snow motes', () => {
        stubCanvasDocument();

        const group = createSurfaceWorldEnvironment();

        expect(group.userData.cabin?.name).toBe('falu-cabin');
        expect(group.userData.foregroundLayer?.name).toBe('foreground-pass-by');
        expect(group.userData.spruces?.name).toBe('spruce-trees');
        expect(group.userData.snowMotes?.name).toBe('snow-motes');
        // The hero must triple its presence: crown upscale applied.
        expect(group.userData.greatTree.scale.x).toBeGreaterThan(1.3);
        // The corridor-wide leaf story doubled the leaf count's reach.
        expect(group.userData.fallingLeaves).toBeTruthy();
    });

    it('drives the season scalar and the season-lerped key light from progress', () => {
        stubCanvasDocument();

        const group = createSurfaceWorldEnvironment();
        const { uniforms } = group.userData;
        const tStart = group.userData.chapterTStart;
        const tEnd = group.userData.chapterTEnd;
        expect(tEnd).toBeGreaterThan(tStart);

        // Spring (chapter start): warm golden key — red channel dominates blue.
        updateSurfaceWorldEnvironment(group, 0.016, 1.0, null, tStart);
        expect(uniforms.uSeason.value).toBe(0);
        const springKey = group.userData.sunKey.color.clone();
        expect(springKey.r).toBeGreaterThan(springKey.b);

        // Winter (chapter end): the key cools — blue overtakes red, intensity drops.
        updateSurfaceWorldEnvironment(group, 0.016, 2.0, null, tEnd);
        expect(uniforms.uSeason.value).toBeCloseTo(1, 5);
        const winterKey = group.userData.sunKey.color;
        expect(winterKey.b).toBeGreaterThan(winterKey.r);
        expect(group.userData.sunKey.intensity).toBeLessThan(0.7);
    });

    it('ramps the chapter entry so the landscape slab cannot pop at the breach', () => {
        const positions = getActiveOdysseyChapterPositions();
        const ch3Start = positions[2];
        const ch4Start = positions[3];

        // Before/at the boundary: invisible or rising; well inside: fully present.
        expect(resolveSurfaceWorldEntryRampState(ch3Start - 0.03, positions).entryOpacity).toBe(0);
        const rising = resolveSurfaceWorldEntryRampState(ch3Start + 0.005, positions).entryOpacity;
        expect(rising).toBeGreaterThan(0);
        expect(rising).toBeLessThan(1);
        const mid = ch3Start + (ch4Start - ch3Start) * 0.5;
        expect(resolveSurfaceWorldEntryRampState(mid, positions).entryOpacity).toBe(1);
        // No progress info (pilot/standalone): fully visible.
        expect(resolveSurfaceWorldEntryRampState(null).entryOpacity).toBe(1);
    });
});
