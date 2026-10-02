import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { deriveOdysseyChapterPositions } from '../../../core/odyssey/data/odyssey-layout.js';
import { ONE_WORLD_ACT_MARGIN } from '../world/odyssey-world-act-gate.js';
import {
    AURORA_BRIDGE,
    createAuroraBridgeBand,
    resolveAuroraBridgeEnvelope,
} from './cosmic-expanse-aurora.js';

/**
 * THE 5->6 CARRY (seamless pass). The 5->6 seam gate allows no brightening after the
 * boundary; the old bridge, gated by the chapter's post-boundary spaceReveal, could ONLY
 * arrive after it (+15.1 luma per 0.01p at p 0.7643). These pin the new contract: grow out of
 * the airglow before the boundary, only ever fall after it, gone by the world switch-off.
 */
describe('ch6 aurora bridge — the airglow grows into an aurora and dissolves into space', () => {
    const positions = deriveOdysseyChapterPositions();
    const ch6 = positions[5];
    const ch7 = positions[6];
    const env = (p) => resolveAuroraBridgeEnvelope(p, ch6, ch7);

    it('is dark through the summit and grows to full BEFORE the boundary', () => {
        expect(env(ch6 - 0.08).glow).toBe(0);
        expect(env(ch6 - 0.02).glow).toBeGreaterThan(0.2);
        expect(env(ch6 - 0.002).glow).toBeCloseTo(1, 3);
        expect(env(ch6).glow).toBe(1);
        // The rise is literal: the curtains climb out of the line.
        expect(env(ch6 - 0.03).grow).toBeLessThan(env(ch6 - 0.015).grow);
    });

    it('only falls after the boundary, and is gone by the One World switch-off', () => {
        let last = env(ch6).glow;
        for (let p = ch6; p <= ch6 + 0.04; p += 0.0005) {
            const { glow } = env(p);
            expect(glow, `p=${p.toFixed(4)}`).toBeLessThanOrEqual(last + 1e-9);
            last = glow;
        }
        const worldOff = ch6 + ONE_WORLD_ACT_MARGIN;
        expect(env(worldOff).glow).toBeLessThan(0.02);
        expect(env(ch6 + (ch7 - ch6) * AURORA_BRIDGE.fallTo).glow).toBe(0);
        // The green dies first: the crimson walk leads the fall.
        expect(env(ch6 + 0.01).crimson).toBeGreaterThan(1 - env(ch6 + 0.01).glow);
    });

    it('stands on the world airglow line, in world-up, around the eye', () => {
        const band = createAuroraBridgeBand();
        expect(band.material.side).toBe(THREE.BackSide);
        expect(band.material.blending).toBe(THREE.AdditiveBlending);
        expect(band.material.depthWrite).toBe(false);
        const { height, radiusTop } = band.geometry.parameters;
        const footY = band.userData.bandCentreY - height / 2;
        // The foot's elevation is the world's airglow band centre (sin = 0.075).
        expect(footY / Math.hypot(footY, radiusTop)).toBeCloseTo(AURORA_BRIDGE.footSin, 4);
        expect(band.visible).toBe(false);
    });
});
