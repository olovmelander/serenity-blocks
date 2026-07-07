/**
 * @fileoverview Unit tests for computeScenePixelRatio — the resolution-cap function the Odyssey
 * low-res fix depends on (masterplan resolution work, 2026-07-05).
 *
 * The fix raised the per-tier `odyssey` scene caps to THEME PARITY (was ~15-20% lower) and let the
 * board pass its selected qualityTier through (so the browser is no longer hard-locked to the High
 * cap). These tests lock in that cap table + the min(dpr, maxPixelRatio, sceneCap) × renderScale
 * math so the resolution never silently regresses. Policy is passed as null in every case to
 * exercise the browser path (no desktop performance policy → quality-tier caps).
 */

import { describe, it, expect } from 'vitest';
import {
    computeScenePixelRatio,
    getScenePixelRatioCap,
} from '../../src/utils/desktop-performance-policy.js';

const NO_POLICY = { policy: null };

describe('computeScenePixelRatio — Odyssey resolution caps', () => {
    it('odyssey now matches the theme cap at every tier (parity fix)', () => {
        for (const tier of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            const odyssey = getScenePixelRatioCap('odyssey', { qualityTier: tier, policy: null });
            const theme = getScenePixelRatioCap('theme', { qualityTier: tier, policy: null });
            expect(odyssey).toBe(theme);
        }
    });

    it('resolves the High odyssey cap to 1.25 (was 1.1) on a hiDPI display', () => {
        const pr = computeScenePixelRatio({
            sceneType: 'odyssey', qualityTier: 'High', devicePixelRatio: 2, maxPixelRatio: 1.5, ...NO_POLICY,
        });
        expect(pr).toBe(1.25); // min(2, 1.5, 1.25) × 1
    });

    it('lets Extreme reach 1.5 / full native (qualityTier plumbing)', () => {
        const pr = computeScenePixelRatio({
            sceneType: 'odyssey', qualityTier: 'Extreme', devicePixelRatio: 2, maxPixelRatio: 1.5, ...NO_POLICY,
        });
        expect(pr).toBe(1.5); // min(2, 1.5, 1.5) × 1
    });

    it('honours the hard ODYSSEY_MAX_PIXEL_RATIO ceiling when it binds below the tier cap', () => {
        const pr = computeScenePixelRatio({
            sceneType: 'odyssey', qualityTier: 'Extreme', devicePixelRatio: 2, maxPixelRatio: 1.2, ...NO_POLICY,
        });
        expect(pr).toBe(1.2); // maxPixelRatio (1.2) is the binding minimum vs cap 1.5 + dpr 2
    });

    it('clamps to the device pixel ratio when it is the lowest term', () => {
        const pr = computeScenePixelRatio({
            sceneType: 'odyssey', qualityTier: 'Extreme', devicePixelRatio: 1, maxPixelRatio: 1.5, ...NO_POLICY,
        });
        expect(pr).toBe(1); // min(1, 1.5, 1.5) × 1 — a dpr=1 desktop is unaffected by the cap raise
    });

    it('multiplies by renderScale (the adaptive controller downscale)', () => {
        const pr = computeScenePixelRatio({
            sceneType: 'odyssey',
            qualityTier: 'High',
            devicePixelRatio: 2,
            maxPixelRatio: 1.5,
            renderScale: 0.6,
            ...NO_POLICY,
        });
        expect(pr).toBe(0.75); // 1.25 × 0.6
    });

    it('the odyssey High cap (1.25) is higher than the old 1.1 and lower tiers step down monotonically', () => {
        const caps = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']
            .map((t) => getScenePixelRatioCap('odyssey', { qualityTier: t, policy: null }));
        expect(caps).toEqual([0.9, 1, 1.15, 1.25, 1.35, 1.5]);
        // strictly non-decreasing across tiers (no inversion)
        for (let i = 1; i < caps.length; i += 1) expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
    });
});
