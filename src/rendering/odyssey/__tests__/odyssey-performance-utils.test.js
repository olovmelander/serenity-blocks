import { describe, expect, it } from 'vitest';
import {
    normalizeOdysseyWarmupMode,
    resolveOdysseyAdaptiveFrameRate,
    resolveOdysseyTargetFrameRate,
    summarizeFrameTimes,
} from '../odyssey-performance-utils.js';

describe('odyssey performance utils', () => {
    it('normalizes warmup modes with legacy fast-start compatibility', () => {
        expect(normalizeOdysseyWarmupMode('current')).toBe('current');
        expect(normalizeOdysseyWarmupMode('focus')).toBe('current');
        expect(normalizeOdysseyWarmupMode('full')).toBe('full');
        expect(normalizeOdysseyWarmupMode('none')).toBe('off');
        expect(normalizeOdysseyWarmupMode('', { fastStartOff: false })).toBe('current');
        expect(normalizeOdysseyWarmupMode('', { fastStartOff: true })).toBe('full');
    });

    it('resolves target frame rate by explicit/url/settings/detected precedence', () => {
        expect(resolveOdysseyTargetFrameRate({
            explicit: 240,
            urlValue: 144,
            settingsValue: 120,
            detectedRefreshRate: 60,
        })).toBe(240);
        expect(resolveOdysseyTargetFrameRate({
            urlValue: '240',
            settingsValue: 144,
        })).toBe(240);
        expect(resolveOdysseyTargetFrameRate({
            settingsValue: 144,
            detectedRefreshRate: 120,
        })).toBe(144);
        expect(resolveOdysseyTargetFrameRate({ detectedRefreshRate: 119 })).toBe(119);
        expect(resolveOdysseyTargetFrameRate({ explicit: 4 })).toBe(30);
        expect(resolveOdysseyTargetFrameRate({ explicit: 2000 })).toBe(1000);
    });

    it('caps adaptive quality target to the detected refresh ceiling', () => {
        expect(resolveOdysseyAdaptiveFrameRate({
            desiredTargetFrameRate: 240,
            detectedRefreshRate: 60,
        })).toBe(60);
        expect(resolveOdysseyAdaptiveFrameRate({
            desiredTargetFrameRate: 240,
            detectedRefreshRate: 240,
        })).toBe(240);
        expect(resolveOdysseyAdaptiveFrameRate({
            desiredTargetFrameRate: 144,
            detectedRefreshRate: null,
        })).toBe(144);
    });

    it('summarizes frame times against a high-refresh budget', () => {
        const summary = summarizeFrameTimes([4, 4.2, 5, 10, 1], 240);

        expect(summary.count).toBe(5);
        expect(summary.budgetMs).toBeCloseTo(4.166, 2);
        expect(summary.p50).toBe(4.2);
        expect(summary.p95).toBe(10);
        expect(summary.p99).toBe(10);
        expect(summary.max).toBe(10);
        expect(summary.overBudget).toBe(3);
    });
});
