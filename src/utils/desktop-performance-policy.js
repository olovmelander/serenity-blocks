import { normalizeQuality } from './quality.js';

const QUALITY_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
const DYNAMIC_SCALE_STEP_DOWN = 0.1;
const DYNAMIC_SCALE_STEP_UP = 0.05;
const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 1.25;
const SCALE_PERSIST_STABILITY_MS = 20000;

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
    Minimal: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 0.9,
        theme: 0.9,
        gameplay: 1,
        odyssey: 1,
    },
    Low: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1,
        theme: 1,
        gameplay: 1.1,
        odyssey: 1.05,
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
        odyssey: 1.2,
    },
    Ultra: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1.35,
        theme: 1.35,
        gameplay: 1.4,
        odyssey: 1.25,
    },
    Extreme: {
        ...DEFAULT_PIXEL_RATIO_CAPS,
        default: 1.5,
        theme: 1.5,
        gameplay: 1.5,
        odyssey: 1.3,
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

export function evaluateDynamicResolutionAdjustment({
    currentRenderScale,
    baselineRenderScale,
    releaseGates = {},
    targetFrameRate = 60,
    lastScaleChangeAt = 0,
    stableSince = 0,
    now = Date.now(),
} = {}) {
    const currentScale = clampRenderScale(currentRenderScale ?? baselineRenderScale ?? 1);
    const baseScale = clampRenderScale(baselineRenderScale ?? currentScale);
    const p95FrameMs = Number(releaseGates?.frameTime?.p95) || 0;
    const p99FrameMs = Number(releaseGates?.frameTime?.p99) || 0;
    const targetFrameMs = targetFrameRate > 0 ? 1000 / targetFrameRate : 1000 / 60;
    const downscaleThreshold = targetFrameMs * 1.14;
    const upscaleThreshold = targetFrameMs * 0.9;
    const elapsedSinceChange = now - (lastScaleChangeAt || 0);

    if (elapsedSinceChange >= 6000 && (p95FrameMs > downscaleThreshold || p99FrameMs > downscaleThreshold * 1.08)) {
        return {
            nextRenderScale: clampRenderScale(currentScale - DYNAMIC_SCALE_STEP_DOWN),
            changed: true,
            reason: 'frame_time_pressure',
            persistEligible: false,
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
        };
    }

    return {
        nextRenderScale: currentScale,
        changed: false,
        reason: 'stable',
        persistEligible: currentScale !== baseScale
            && stableSince > 0
            && (now - stableSince) >= SCALE_PERSIST_STABILITY_MS,
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
