/**
 * Sunfall Theme — Quality Tier Presets
 *
 * Six deterministic tiers from Minimal to Extreme.
 * Every tier preserves the core Hang Sơn Đoòng doline silhouette:
 * the sky-bright oculus, the sunlit chartreuse jungle cone, the green-gold
 * bounce on the cave vault, the second far doline down the passage, and the
 * closed-form Simpson's-rule sunbeam pillar (augmented with a TSL Loop march
 * from Medium upward).
 */

import { normalizeQuality } from '../../utils/quality.js';

export const SUNFALL_QUALITY_ORDER = Object.freeze([
    'Minimal',
    'Low',
    'Medium',
    'High',
    'Ultra',
    'Extreme',
]);

export const SUNFALL_QUALITY_PRESETS = Object.freeze({
    Minimal: Object.freeze({
        tier: 'Minimal',
        leafSlots: 96,
        crownShare: 0.45,
        beamSamples: 0,
        beamFringe: false,
        fringeCurtains: 6,
        leafInstances: 900,
        rootTendrils: 60,
        newGrowthSlots: 0,
        moteCount: 160,
        dripStreams: 0,
        showerDrops: 0,
        swiftCount: 0,
        gourPools: 0,
        caveTris: 4000,
        farDoline: true,
        cloudSheet: false,
        enablePost: false,
        enableBloom: false,
        bloomStrength: 0,
        bloomRadius: 0,
        bloomDownsample: 1.0,
        enableFXAA: false,
        msaaSamples: 0,
    }),
    Low: Object.freeze({
        tier: 'Low',
        leafSlots: 160,
        crownShare: 0.6,
        beamSamples: 0,
        beamFringe: true,
        fringeCurtains: 6,
        leafInstances: 1800,
        rootTendrils: 120,
        newGrowthSlots: 16,
        moteCount: 360,
        dripStreams: 16,
        showerDrops: 120,
        swiftCount: 16,
        gourPools: 3,
        caveTris: 7000,
        farDoline: true,
        cloudSheet: true,
        enablePost: true,
        enableBloom: false,
        bloomStrength: 0,
        bloomRadius: 0,
        bloomDownsample: 0.5,
        enableFXAA: true,
        msaaSamples: 0,
    }),
    Medium: Object.freeze({
        tier: 'Medium',
        leafSlots: 256,
        crownShare: 0.8,
        beamSamples: 6,
        beamFringe: true,
        fringeCurtains: 8,
        leafInstances: 3200,
        rootTendrils: 200,
        newGrowthSlots: 24,
        moteCount: 700,
        dripStreams: 28,
        showerDrops: 260,
        swiftCount: 28,
        gourPools: 4,
        caveTris: 11000,
        farDoline: true,
        cloudSheet: true,
        enablePost: true,
        enableBloom: true,
        bloomStrength: 0.14,
        bloomRadius: 0.45,
        bloomDownsample: 0.5,
        enableFXAA: true,
        msaaSamples: 0,
    }),
    High: Object.freeze({
        tier: 'High',
        leafSlots: 384,
        crownShare: 1,
        beamSamples: 8,
        beamFringe: true,
        fringeCurtains: 10,
        leafInstances: 5200,
        rootTendrils: 320,
        newGrowthSlots: 36,
        moteCount: 1200,
        dripStreams: 40,
        showerDrops: 480,
        swiftCount: 40,
        gourPools: 5,
        caveTris: 16000,
        farDoline: true,
        cloudSheet: true,
        enablePost: true,
        enableBloom: true,
        bloomStrength: 0.16,
        bloomRadius: 0.52,
        bloomDownsample: 0.5,
        enableFXAA: false,
        msaaSamples: 4,
    }),
    Ultra: Object.freeze({
        tier: 'Ultra',
        leafSlots: 512,
        crownShare: 1,
        beamSamples: 12,
        beamFringe: true,
        fringeCurtains: 12,
        leafInstances: 7800,
        rootTendrils: 440,
        newGrowthSlots: 48,
        moteCount: 1800,
        dripStreams: 56,
        showerDrops: 720,
        swiftCount: 52,
        gourPools: 6,
        caveTris: 22000,
        farDoline: true,
        cloudSheet: true,
        enablePost: true,
        enableBloom: true,
        bloomStrength: 0.17,
        bloomRadius: 0.56,
        bloomDownsample: 0.65,
        enableFXAA: false,
        msaaSamples: 4,
    }),
    Extreme: Object.freeze({
        tier: 'Extreme',
        leafSlots: 640,
        crownShare: 1,
        beamSamples: 16,
        beamFringe: true,
        fringeCurtains: 14,
        leafInstances: 10500,
        rootTendrils: 580,
        newGrowthSlots: 64,
        moteCount: 2500,
        dripStreams: 72,
        showerDrops: 1000,
        swiftCount: 64,
        gourPools: 6,
        caveTris: 28000,
        farDoline: true,
        cloudSheet: true,
        enablePost: true,
        enableBloom: true,
        bloomStrength: 0.18,
        bloomRadius: 0.60,
        bloomDownsample: 0.75,
        enableFXAA: false,
        msaaSamples: 4,
    }),
});

/**
 * Resolve a quality name (case-insensitive) onto a frozen Sunfall preset.
 * Defaults to High when unspecified or unrecognized.
 * @param {string} [quality]
 */
export function resolveSunfallQuality(quality = 'High') {
    const normalized = normalizeQuality(quality || 'High');
    return SUNFALL_QUALITY_PRESETS[normalized] || SUNFALL_QUALITY_PRESETS.High;
}

export const SUNFALL_PIXEL_RATIO_CAP = Object.freeze({
    Minimal: 0.7,
    Low: 0.85,
    Medium: 1.0,
    High: 1.15,
    Ultra: 1.35,
    Extreme: 1.6,
});

export function readSunfallFlags() {
    const empty = {
        forceWebGL: false,
        time: null,
        fixedDt: null,
        parts: null,
        falseColor: false,
        noPost: false,
    };
    if (typeof window === 'undefined') return empty;
    const params = new URLSearchParams(window.location?.search || '');
    const bool = (k) => params.has(k) && ['', '1', 'true', 'yes', 'on'].includes((params.get(k) || '').toLowerCase());
    const num = (k) => {
        const raw = params.get(k);
        if (raw === null || raw === '') return null;
        const v = Number(raw);
        return Number.isFinite(v) ? v : null;
    };
    const t = num('sunfallTime');
    const dt = num('sunfallFixedDt');
    return {
        forceWebGL: bool('forceWebGL') || bool('sunfallForceWebGL'),
        time: t !== null && t >= 0 ? t : null,
        fixedDt: dt !== null && dt > 0 ? dt / (dt > 1 ? 1000 : 1) : null,
        parts: params.get('sunfallParts')
            ? params.get('sunfallParts').split(',').map((p) => p.trim()).filter(Boolean)
            : null,
        falseColor: bool('sunfallFalseColor'),
        noPost: bool('sunfallNoPost'),
    };
}

export function readSunfallSettingUpdate(payload, key) {
    const detail = payload?.detail || payload || null;
    if (!detail) return { present: false, value: undefined };
    if (detail.type === key) return { present: true, value: detail.value ?? detail[key] ?? detail.settings?.[key] };
    const sources = [detail, detail.changed, detail.settings];
    for (let i = 0; i < sources.length; i += 1) {
        const src = sources[i];
        if (src && typeof src === 'object' && Object.prototype.hasOwnProperty.call(src, key)) {
            return { present: true, value: src[key] };
        }
    }
    return { present: false, value: undefined };
}

export function readSunfallSetting(payload, key) {
    const update = readSunfallSettingUpdate(payload, key);
    if (update.present) return update.value;
    return typeof window !== 'undefined' ? window.settings?.[key] : undefined;
}

export function boolSunfallSetting(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        if (['false', '0', 'off', 'no'].includes(v)) return false;
        if (['true', '1', 'on', 'yes'].includes(v)) return true;
    }
    return value === true;
}
