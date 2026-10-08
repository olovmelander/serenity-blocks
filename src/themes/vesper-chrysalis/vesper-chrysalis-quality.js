import { normalizeQuality } from '../../utils/quality.js';

/** Keep playground overrides and the shipped graphics setting on the same quality tier. */
export function resolveVesperQuality(params, settings) {
    return normalizeQuality(
        params?.get?.('quality')
        || settings?.effectQuality
        || settings?.graphicsQuality
        || 'High',
    );
}
