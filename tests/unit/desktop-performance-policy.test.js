import { describe, expect, it } from 'vitest';
import {
    clampRenderScale,
    createDesktopPerformancePolicy,
    evaluateDynamicResolutionAdjustment,
    getPackagedWindowsRecommendedSettings,
} from '../../src/utils/desktop-performance-policy.js';

describe('desktop performance policy', () => {
    it('recommends more conservative first-run settings for larger displays', () => {
        expect(getPackagedWindowsRecommendedSettings({
            screenWidth: 3840,
            screenHeight: 2160,
            devicePixelRatio: 1.5,
            monitorRefreshRate: 144,
        })).toEqual({
            renderScale: 0.65,
            qualityTier: 'Medium',
            targetFrameRate: 144,
        });
    });

    it('degrades the resolved desktop policy when GPU health is unsafe', () => {
        const policy = createDesktopPerformancePolicy({
            settingsSnapshot: {
                renderScale: 1,
                effectQuality: 'Ultra',
                targetFrameRate: 144,
                vsyncEnabled: true,
                displayMode: 'windowed',
            },
            runtimeConfig: {
                windowsProfile: 'baseline',
                appMode: 'packaged',
            },
            gpuHealth: {
                status: 'unsafe',
            },
            monitorRefreshRate: 144,
            windowSize: {
                width: 2560,
                height: 1440,
            },
            devicePixelRatio: 1.5,
        });

        expect(policy.qualityTier).toBe('Medium');
        expect(policy.renderScale).toBe(0.65);
        expect(policy.runtimeProfile).toBe('baseline');
        expect(policy.internalRenderResolution.width).toBeGreaterThan(0);
        expect(policy.internalRenderResolution.effectivePixelRatio).toBeLessThan(1);
    });

    it('keeps render scale within supported bounds', () => {
        expect(clampRenderScale(2)).toBe(1.25);
        expect(clampRenderScale(0.25)).toBe(0.5);
        expect(clampRenderScale(0.83)).toBe(0.83);
    });

    it('downscales when p95 frame time exceeds the target budget', () => {
        const adjustment = evaluateDynamicResolutionAdjustment({
            currentRenderScale: 1,
            baselineRenderScale: 1,
            releaseGates: {
                frameTime: {
                    p95: 22,
                    p99: 24,
                },
            },
            targetFrameRate: 60,
            lastScaleChangeAt: Date.now() - 8000,
        });

        expect(adjustment.changed).toBe(true);
        expect(adjustment.nextRenderScale).toBe(0.9);
        expect(adjustment.reason).toBe('frame_time_pressure');
    });

    it('marks recovered dynamic resolution as persist-eligible after a stable window', () => {
        const now = Date.now();
        const adjustment = evaluateDynamicResolutionAdjustment({
            currentRenderScale: 0.8,
            baselineRenderScale: 1,
            releaseGates: {
                frameTime: {
                    p95: 15.2,
                    p99: 15.8,
                },
            },
            targetFrameRate: 60,
            lastScaleChangeAt: now - 25000,
            stableSince: now - 21000,
            now,
        });

        expect(adjustment.changed).toBe(false);
        expect(adjustment.persistEligible).toBe(true);
        expect(adjustment.reason).toBe('stable');
    });
});
