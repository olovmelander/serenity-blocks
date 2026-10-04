import { WebGPURenderer } from 'three/webgpu';

/**
 * Keep one node-material scene on WebGPU and WebGL2. A failed GPU candidate
 * must not donate its canvas to the retry; each constructor creates its own.
 * BaseTheme owns cancellation, bounded initialization and candidate retirement.
 */
export async function initializeThemeNodeRenderer(theme, rendererOptions, {
    ownerGeneration = theme.lifecycleGeneration,
    timeoutMs = 4000,
    label = theme.name,
} = {}) {
    const params = new URLSearchParams(globalThis.window?.location?.search || '');
    const requestedWebGL = params.has('forceWebGL')
        && ['', '1', 'true', 'yes', 'on'].includes((params.get('forceWebGL') || '').toLowerCase());
    const forceWebGL = requestedWebGL || !globalThis.navigator?.gpu;
    const isCurrent = () => ownerGeneration === theme.lifecycleGeneration
        && theme.isActive && !theme.cleanupComplete;
    let renderer = new WebGPURenderer({ ...rendererOptions, forceWebGL });
    try {
        await theme.initializeRendererCandidate(renderer, {
            timeoutMs, label: `${label} node renderer init`, ownerGeneration,
        });
    } catch (error) {
        if (!isCurrent()) return null;
        if (forceWebGL) throw error;
        renderer = new WebGPURenderer({ ...rendererOptions, forceWebGL: true });
        await theme.initializeRendererCandidate(renderer, {
            timeoutMs, label: `${label} WebGL2 renderer init`, ownerGeneration,
        });
    }
    if (!isCurrent()) {
        await theme.disposeRenderer(renderer, { nullInstance: false });
        return null;
    }
    return renderer;
}
