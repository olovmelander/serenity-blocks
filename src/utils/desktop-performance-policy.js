import { normalizeQuality } from './quality.js';

const QUALITY_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
const DYNAMIC_SCALE_STEP_DOWN = 0.1;
const DYNAMIC_SCALE_STEP_UP = 0.05;
const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 1.25;
const SCALE_PERSIST_STABILITY_MS = 20000;

// Odyssey scene pixel-ratio ceilings. Previously (QW3) the `odyssey` cap was pinned
// ~15-20% BELOW the theme cap because the scene was assumed GPU fill-rate bound, which made
// Odyssey visibly softer/lower-res than a single-scene theme on the SAME display (user
// report 2026-07-05). It is now brought to THEME PARITY at every tier: the ceiling is what
// a capable GPU renders at, and the adaptive controllers ride `renderScale` down toward
// MIN_RENDER_SCALE on weaker GPUs, so raising the ceiling helps strong GPUs reach full
// resolution without hurting weak ones. Odyssey still carries more fill per pixel (heavy
// post + additive seam layers), so its adaptive controller will simply back off sooner.
const DEFAULT_PIXEL_RATIO_CAPS = {
    default: 1.35,
    theme: 1.35,
    menu: 1.15,
    gameplay: 1.4,
    odyssey: 1.25,
    hub: 1,
    settings: 1,
};

const QUALITY_PIXEL_RATIO_CAPS = {
    // `odyssey` now matches the `theme` cap at each tier (was ~15-20% lower). Ordering stays
    // monotonic across tiers; other scene types are unchanged.
    Minimal: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 0.9,
        theme: 0.9,
        gameplay: 1,
        odyssey: 0.9,
    },
    Low: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1,
        theme: 1,
        gameplay: 1.1,
        odyssey: 1,
    },
    Medium: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1.15,
        theme: 1.15,
        gameplay: 1.2,
        odyssey: 1.15,
    },
    High: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1.25,
        theme: 1.25,
        gameplay: 1.3,
        odyssey: 1.25,
    },
    Ultra: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1.35,
        theme: 1.35,
        gameplay: 1.4,
        odyssey: 1.35,
    },
    Extreme: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1.5,
        theme: 1.5,
        gameplay: 1.5,
        odyssey: 1.5,
    },
};

const SUPPORTED_FRAME_RATE_TARGETS = [60, 120, 144, 240];

let activeDesktopPerformancePolicy = null;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getQualityIndex(level) {
    return QUALITY_ORDER.indexOf(normalizeQuality(level));
}

export function shiftQualityTier(level, offset = 0) {
    const normalized = normalizeQuality(level);
    const index = getQualityIndex(normalized);
    const nextIndex = index === -1
        ? QUALITY_ORDER.indexOf('High')
        : clamp(index + offset, 0, QUALITY_ORDER.length - 1);
    return QUALITY_ORDER[nextIndex];
}

export function clampRenderScale(scale, {
    min = MIN_RENDER_SCALE,
    max = MAX_RENDER_SCALE,
} = {}) {
    const numericScale = Number.isFinite(scale) ? scale : 1;
    return Number(clamp(numericScale, min, max).toFixed(2));
}

export function getNearestSupportedFrameRate(target) {
    if (!Number.isFinite(target) || target <= 0) {
        return 60;
    }

    return SUPPORTED_FRAME_RATE_TARGETS.find((candidate) => target <= candidate) || 240;
}

export function getPackagedWindowsRecommendedSettings({
    screenWidth = 1920,
    screenHeight = 1080,
    devicePixelRatio = 1,
    monitorRefreshRate = 60,
} = {}) {
    const totalPixels = Math.max(1, screenWidth) * Math.max(1, screenHeight) * Math.max(1, devicePixelRatio);
    let renderScale = 1;
    let qualityTier = 'High';

    if (totalPixels >= 9_000_000) {
        renderScale = 0.65;
        qualityTier = 'Medium';
    } else if (totalPixels >= 5_500_000) {
        renderScale = 0.8;
        qualityTier = 'High';
    } else if (totalPixels >= 3_600_000) {
        renderScale = 0.9;
        qualityTier = 'High';
    } else {
        renderScale = 1;
        qualityTier = 'Ultra';
    }

    return {
        renderScale,
        qualityTier,
        targetFrameRate: getNearestSupportedFrameRate(monitorRefreshRate),
    };
}

export function deriveQualityTierFromGpuHealth(baseQuality, gpuHealth = null) {
    const normalizedBase = normalizeQuality(baseQuality || 'High');
    const status = gpuHealth?.status || 'unknown';

    if (status === 'unsafe') {
        return shiftQualityTier(normalizedBase, -2);
    }

    if (status === 'degraded') {
        return shiftQualityTier(normalizedBase, -1);
    }

    return normalizedBase;
}

export function getPixelRatioCapsForQuality(qualityTier = 'High') {
    return QUALITY_PIXEL_RATIO_CAPS[normalizeQuality(qualityTier)] || QUALITY_PIXEL_RATIO_CAPS.High;
}

export function getScenePixelRatioCap(sceneType = 'default', {
    qualityTier = 'High',
    policy = activeDesktopPerformancePolicy,
} = {}) {
    const caps = policy?.pixelRatioCaps || getPixelRatioCapsForQuality(qualityTier);
    return caps?.[sceneType] ?? caps?.default ?? DEFAULT_PIXEL_RATIO_CAPS.default;
}

export function computeScenePixelRatio({
    renderScale = 1,
    devicePixelRatio = 1,
    maxPixelRatio = 2,
    sceneType = 'default',
    qualityTier = 'High',
    policy = activeDesktopPerformancePolicy,
} = {}) {
    const sceneCap = getScenePixelRatioCap(sceneType, { qualityTier, policy });
    return Number((Math.min(devicePixelRatio || 1, maxPixelRatio, sceneCap) * clampRenderScale(renderScale)).toFixed(2));
}

export function createDesktopPerformancePolicy({
    settingsSnapshot = {},
    runtimeConfig = {},
    gpuHealth = null,
    monitorRefreshRate = 60,
    windowSize = null,
    devicePixelRatio = 1,
} = {}) {
    const recommended = getPackagedWindowsRecommendedSettings({
        screenWidth: windowSize?.width || globalThis.window?.screen?.width || globalThis.window?.innerWidth || 1920,
        screenHeight: windowSize?.height || globalThis.window?.screen?.height || globalThis.window?.innerHeight || 1080,
        devicePixelRatio,
        monitorRefreshRate,
    });
    const baseQuality = normalizeQuality(settingsSnapshot?.effectQuality || recommended.qualityTier);
    const qualityTier = deriveQualityTierFromGpuHealth(baseQuality, gpuHealth);
    const fallbackRenderScale = clampRenderScale(settingsSnapshot?.renderScale ?? recommended.renderScale);
    let renderScale = fallbackRenderScale;

    if (gpuHealth?.status === 'unsafe') {
        renderScale = Math.min(renderScale, 0.65);
    } else if (gpuHealth?.status === 'degraded') {
        renderScale = Math.min(renderScale, 0.85);
    }

    const pixelRatioCaps = getPixelRatioCapsForQuality(qualityTier);
    const targetFrameRate = Number.isFinite(settingsSnapshot?.targetFrameRate) && settingsSnapshot.targetFrameRate > 0
        ? settingsSnapshot.targetFrameRate
        : recommended.targetFrameRate;
    const effectivePixelRatio = computeScenePixelRatio({
        renderScale,
        devicePixelRatio,
        maxPixelRatio: 2,
        sceneType: 'theme',
        qualityTier,
        policy: { pixelRatioCaps },
    });
    const viewportWidth = Math.max(1, windowSize?.width || globalThis.window?.innerWidth || 1);
    const viewportHeight = Math.max(1, windowSize?.height || globalThis.window?.innerHeight || 1);

    return {
        renderScale,
        baseRenderScale: fallbackRenderScale,
        qualityTier,
        pixelRatioCaps,
        targetFrameRate,
        vsyncMode: settingsSnapshot?.vsyncEnabled === false ? 'off' : 'on',
        displayMode: settingsSnapshot?.displayMode || 'windowed',
        devicePixelRatio,
        internalRenderResolution: {
            width: Math.max(1, Math.round(viewportWidth * effectivePixelRatio)),
            height: Math.max(1, Math.round(viewportHeight * effectivePixelRatio)),
            effectivePixelRatio,
        },
        runtimeProfile: runtimeConfig?.windowsProfile || runtimeConfig?.appMode || 'browser-dev',
        gpuHealth: gpuHealth || runtimeConfig?.gpuHealth || null,
        gpuFallbackActive: runtimeConfig?.gpuFallbackActive === true || gpuHealth?.status === 'unsafe',
        runtimeProfileMode: runtimeConfig?.runtimeProfileMode || 'shipping',
    };
}

/**
 * The display's achieved pace when it, not the GPU, sets the frame rate; 0 otherwise.
 *
 * Frame times are presentation gaps: they never read below what the display delivers. Chromium
 * presents some panels well below their reported rate (the owner's laptop: 240 Hz reported, ~178
 * delivered, frames 4.9-6.8 ms against a 240 target's 4.17 ms budget; another dev laptop: 165
 * reported, 131.6 delivered). Judged against the budget alone that was pressure every 6 s, down to
 * the floor (0.5) with no way back, whenever the FPS counter was on
 * (docs/THEME_FLEET_240_2026-10.md §8). The display is pacing when even the quick frames (p10) are
 * slower than the budget and the typical frame (p50) is within the 1.25-1.35 refresh intervals such
 * a display delivers. A GPU that misses its vblanks lands on whole intervals instead: quick frames
 * on the refresh with a slow tail, or 2x at a steady half rate, so those still read as pressure.
 * Without a known refresh rate the two cannot be told apart: 0.
 * @param {{p10?: number, p50?: number}} frameTime the window's frame-time percentiles (ms)
 * @param {number} targetFrameMs the target's frame budget
 * @param {number} refreshRate the refresh rate the display reports (Hz)
 * @returns {number} the pace (the window's p50) in ms, or 0
 */
export function displayBoundCadence(frameTime, targetFrameMs, refreshRate) {
    const p10 = Number(frameTime?.p10) || 0;
    const p50 = Number(frameTime?.p50) || 0;
    if (!(p10 > 0) || !(p50 > 0) || !(refreshRate > 0) || !(targetFrameMs > 0)) return 0;
    return p10 > targetFrameMs * 1.05 && p50 < (1000 / refreshRate) * 1.45 ? p50 : 0;
}

export function evaluateDynamicResolutionAdjustment({
    currentRenderScale,
    baselineRenderScale,
    releaseGates = {},
    targetFrameRate = 60,
    lastScaleChangeAt = 0,
    stableSince = 0,
    now = Date.now(),
    // A caller that judges headroom itself (Odyssey's, at the display's cadence) passes its own
    // gate: Infinity = has headroom, 0 = none. Default: p95 under 0.9x the frame budget.
    upscaleThresholdMs = null,
    // The refresh rate the display reports (Hz), for telling a display that cannot present the
    // target's rate from a GPU that cannot render it (displayBoundCadence). Unknown: 0.
    refreshRate = 0,
    // A caller that ticks passes whether its last tick read pressure (the result's `pressure`):
    // pressure then steps down only on a repeat, so one hitch (a mode start, a theme switch, a
    // game over) in a window is not a resolution problem. null: act on the first.
    lastTickPressure = null,
} = {}) {
    const currentScale = clampRenderScale(currentRenderScale ?? baselineRenderScale ?? 1);
    const baseScale = clampRenderScale(baselineRenderScale ?? currentScale);
    const p95FrameMs = Number(releaseGates?.frameTime?.p95) || 0;
    const p99FrameMs = Number(releaseGates?.frameTime?.p99) || 0;
    const targetFrameMs = targetFrameRate > 0 ? 1000 / targetFrameRate : 1000 / 60;
    const pace = displayBoundCadence(releaseGates?.frameTime, targetFrameMs, refreshRate);
    // Display-bound: pressure is frames regularly slipping past the display's own pace (p95), or a
    // tail of frames missing two of its slots (p99); holding that pace is headroom, so a lowered
    // scale climbs back.
    const downscaleThreshold = pace > 0 ? Math.max(targetFrameMs * 1.14, pace * 1.5) : targetFrameMs * 1.14;
    const tailThreshold = pace > 0 ? Math.max(targetFrameMs * 1.14 * 1.08, pace * 2.2) : downscaleThreshold * 1.08;
    let upscaleThreshold = pace > 0 ? pace * 1.3 : targetFrameMs * 0.9;
    if (typeof upscaleThresholdMs === 'number' && !Number.isNaN(upscaleThresholdMs)) upscaleThreshold = upscaleThresholdMs;
    const elapsedSinceChange = now - (lastScaleChangeAt || 0);
    const pressure = p95FrameMs > downscaleThreshold || p99FrameMs > tailThreshold;

    if (elapsedSinceChange >= 6000 && pressure && lastTickPressure === false) {
        return {
            nextRenderScale: currentScale,
            changed: false,
            reason: 'pressure_pending',
            persistEligible: false,
            pressure,
        };
    }

    if (elapsedSinceChange >= 6000 && pressure) {
        return {
            nextRenderScale: clampRenderScale(currentScale - DYNAMIC_SCALE_STEP_DOWN),
            changed: true,
            reason: 'frame_time_pressure',
            persistEligible: false,
            pressure,
        };
    }

    if (elapsedSinceChange >= 12000
        && currentScale < baseScale
        && p95FrameMs > 0
        && p95FrameMs < upscaleThreshold) {
        const nextRenderScale = clampRenderScale(Math.min(baseScale, currentScale + DYNAMIC_SCALE_STEP_UP));
        return {
            nextRenderScale,
            changed: nextRenderScale !== currentScale,
            reason: 'frame_time_recovered',
            persistEligible: nextRenderScale === currentScale && stableSince > 0 && (now - stableSince) >= SCALE_PERSIST_STABILITY_MS,
            pressure,
        };
    }

    return {
        nextRenderScale: currentScale,
        changed: false,
        reason: 'stable',
        persistEligible: currentScale !== baseScale
            && stableSince > 0
            && (now - stableSince) >= SCALE_PERSIST_STABILITY_MS,
        pressure,
    };
}

export function setActiveDesktopPerformancePolicy(policy) {
    activeDesktopPerformancePolicy = policy ? {
        ...policy,
        pixelRatioCaps: policy.pixelRatioCaps ? { ...policy.pixelRatioCaps } : getPixelRatioCapsForQuality(policy.qualityTier),
    } : null;
    return activeDesktopPerformancePolicy;
}

export function getActiveDesktopPerformancePolicy() {
    return activeDesktopPerformancePolicy;
}
