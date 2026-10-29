import { describe, expect, it } from 'vitest';
import {
    clampRenderScale,
    createDesktopPerformancePolicy,
    displayBoundCadence,
    evaluateDynamicResolutionAdjustment,
    getPackagedWindowsRecommendedSettings,
} from '../../src/utils/desktop-performance-policy.js';
import { PerformanceMonitor } from '../../src/utils/performance-monitor.js';

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

describe('a display that cannot present the target rate is not frame-time pressure', () => {
    // Five-second windows (every frame since the last tick) logged in the desktop app on the owner's
    // laptop at a 240 target: Chromium presents ~178 of its 240 Hz.
    const LAPTOP = {
        frameTime: {
            p10: 4.9, p50: 5.5, p95: 6.7, p99: 9.1,
        },
    };
    const step = (scale, releaseGates, now, lastScaleChangeAt, extra = {}) => evaluateDynamicResolutionAdjustment({
        currentRenderScale: scale,
        baselineRenderScale: 1,
        releaseGates,
        targetFrameRate: 240,
        lastScaleChangeAt,
        stableSince: 0,
        now,
        refreshRate: 240,
        ...extra,
    });
    // The 5 s tick as main.js applies it, from scale 1, over `windows` (one per tick).
    const walk = (windows, extra = {}) => {
        let scale = 1;
        let changedAt = 0;
        let lastTickPressure = false;
        windows.forEach((releaseGates, tick) => {
            const now = (tick + 1) * 5000;
            const a = step(scale, releaseGates, now, changedAt, { lastTickPressure, ...extra });
            lastTickPressure = a.pressure === true;
            if (a.changed && a.nextRenderScale !== scale) {
                scale = a.nextRenderScale;
                changedAt = now;
            }
        });
        return scale;
    };

    it('used to walk to the floor in a minute and stay there; now it holds the scale', () => {
        const minute = Array(12).fill(LAPTOP);
        expect(walk(minute, { refreshRate: 0, lastTickPressure: null })).toBe(0.5); // the old judgement: budget only
        expect(walk(minute)).toBe(1);
    });

    it('holds through every window logged in two minutes of play', () => {
        const logged = [[4.9, 5.5, 6.6, 7.8], [4.9, 5.5, 6.6, 8.6], [5, 5.5, 6.8, 9.2], [4.9, 5.5, 6.6, 9],
            [5, 5.5, 6.5, 7.9], [4.9, 5.5, 6.8, 9.2], [5, 5.5, 6.8, 9.4], [4.9, 5.5, 6.9, 11], [4.9, 5.5, 6.7, 10]];
        const windows = logged.map(([p10, p50, p95, p99]) => ({
            frameTime: {
                p10, p50, p95, p99,
            },
        }));
        expect(walk(windows)).toBe(1);
    });

    it('lets one hitch (the mode start, a game over) pass: pressure acts on a repeat', () => {
        // The first window of a game: the board's start frames put p99 at 20 ms.
        const start = {
            frameTime: {
                p10: 4.9, p50: 5.5, p95: 6.8, p99: 20.4,
            },
        };
        expect(step(1, start, 10000, 0, { lastTickPressure: false })).toMatchObject({
            changed: false, reason: 'pressure_pending', pressure: true,
        });
        expect(walk([start, LAPTOP, LAPTOP, start, LAPTOP])).toBe(1);
        expect(walk([start, start])).toBe(0.9);
        // A caller that does not tick (no lastTickPressure) acts at once, as before.
        expect(step(1, start, 10000, 0)).toMatchObject({ changed: true, reason: 'frame_time_pressure' });
    });

    it('lets a lowered scale climb back while the display holds its pace', () => {
        const a = step(0.9, LAPTOP, 60000, 40000, { lastTickPressure: false });
        expect(a).toMatchObject({ changed: true, reason: 'frame_time_recovered', nextRenderScale: 0.95 });
        expect(walk([...Array(2).fill({ frameTime: { p10: 4.9, p50: 5.5, p95: 20, p99: 30 } }), ...Array(12).fill(LAPTOP)]))
            .toBe(1);
    });

    it('still steps down when frames slip past the display pace (the GPU falling behind it)', () => {
        const slipping = {
            frameTime: {
                p10: 5, p50: 5.6, p95: 9.6, p99: 12,
            },
        };
        expect(walk([slipping, slipping])).toBe(0.9);
        // Slower than the display ever delivers: the budget judges.
        const slow = {
            frameTime: {
                p10: 5.4, p50: 6.5, p95: 7.2, p99: 8,
            },
        };
        expect(walk([slow, slow])).toBe(0.9);
    });

    it('still steps down for a GPU that misses vblanks on a display that keeps up', () => {
        // Quick frames on the refresh, a slow tail of doubled ones.
        const missing = {
            frameTime: {
                p10: 4.17, p50: 4.2, p95: 8.33, p99: 8.4,
            },
        };
        expect(walk([missing, missing])).toBe(0.9);
        // A steady half rate: every frame two intervals.
        const half = {
            frameTime: {
                p10: 8.3, p50: 8.33, p95: 8.4, p99: 8.5,
            },
        };
        expect(walk([half, half])).toBe(0.9);
    });

    it('reads a pace only for a display slower than the budget, not near whole intervals', () => {
        const budget = 1000 / 240;
        expect(displayBoundCadence({ p10: 4.9, p50: 5.5 }, budget, 240)).toBe(5.5);
        expect(displayBoundCadence({ p10: 4.17, p50: 4.2 }, budget, 240)).toBe(0); // on the refresh: the budget holds
        expect(displayBoundCadence({ p10: 8.3, p50: 8.33 }, budget, 240)).toBe(0); // two intervals: the GPU
        expect(displayBoundCadence({ p10: 5.4, p50: 6.5 }, budget, 240)).toBe(0); // past what such a display delivers
        expect(displayBoundCadence({ p10: 4.9, p50: 5.5 }, budget, 0)).toBe(0); // unknown refresh: cannot tell
        expect(displayBoundCadence({}, budget, 240)).toBe(0);
        // 165 reported, 131.6 delivered (Odyssey's audit laptop), target 165.
        expect(displayBoundCadence({ p10: 7.2, p50: 7.6 }, 1000 / 165, 165)).toBe(7.6);
    });
});

describe('the dynamic resolution window', () => {
    it('reads every frame of the last five seconds, not the last 60', () => {
        const monitor = new PerformanceMonitor();
        // Ten seconds at ~180 fps: a slow first half, then a quick one.
        monitor.frameTimeLog = [...Array(900).fill(9), ...Array(900).fill(5.5)];
        monitor.frameTimeLog[1700] = 30;
        const w = monitor.getRecentFrameTimePercentiles(5000);
        expect(w.count).toBe(903); // the quick half (4974.5 ms with its one 30 ms frame) and three slow frames
        expect(w).toMatchObject({ p10: 5.5, p50: 5.5, p95: 5.5 });
        expect(monitor.getRecentFrameTimePercentiles(1e9).count).toBe(1800);
        expect(new PerformanceMonitor().getRecentFrameTimePercentiles(5000)).toMatchObject({ count: 0, p50: 0, p99: 0 });
    });
});
