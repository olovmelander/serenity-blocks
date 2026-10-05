import path from 'node:path';
import { getRenderScale, normalizeQuality } from '../../src/utils/quality.js';
import { computeScenePixelRatio } from '../../src/utils/desktop-performance-policy.js';
import { getIntroVisualProfile, getQualityBudget } from '../../src/ui/intro-visual-config.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';

export const MOBILE_WEBGL2_SMOKE_IDS = Object.freeze([
    'wolfhour', 'shifting-sands', 'ocean', 'winter', 'starlight',
    'chiral-gold', 'waves', 'solar-eclipse', 'stellar-drift', 'stellar-velocity',
    'void-ember', 'rainy-window', 'nebula-flow', 'serenity-warp',
    'pyrestorm', 'fall', 'mountain',
]);

// These authored node scenes must not quietly select their old classic twins.
export const MOBILE_WEBGL2_NODE_IDS = Object.freeze([
    'astral-weave', 'chiral-gold', 'cosmic-noir', 'crystal-cave', 'fluid-dreams', 'golden-forest',
    'ice-temple', 'lunara', 'ocean', 'stellar-drift', 'stellar-velocity',
    'electric-dreams-v3', 'himalayan-peak', 'winter', 'starlight',
    'wolfhour', 'shifting-sands', 'moonlit-forest', 'sky-children',
]);

const QUALITY_NAMES = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
const VALUE_OPTIONS = new Set(['theme', 'quality', 'dpr', 'render-scale', 'out', 'executable']);
const BOOLEAN_OPTIONS = new Set(['all', 'list', 'help']);
// Budget assertions complement quality labels: a correct getter with a High
// fallback allocation was the failure mode in this continuation audit.
const MINIMAL_PRESET_EXPECTATIONS = {
    'chiral-gold': { goldDustCount: 1500, enablePostProcessing: false },
    'solar-eclipse': { starCount: 800, enablePostProcessing: false },
    'stellar-drift': { meteorCount: 50, enablePostProcessing: false },
    'stellar-velocity': { starCount: 500, enablePostProcessing: false },
    waves: { sprayCount: 150, enablePostProcessing: false },
    pyrestorm: { emberCount: 1000, ashCount: 200, enableBloom: false },
    fall: { leafCount: 500, treeCount: 20, enablePost: false },
    winter: { snowCount: 3000, auroraLayers: 1, enablePostProcessing: false },
    mountain: { maxParticles: 5, enableLightning: false },
};

// Main.handleResize pulls the current window dimensions, then ThemeManager
// forwards them to its active owner. Isolated captures need that same step;
// installing only the broadcaster omits manager-driven themes such as Koi Pond.
export function installMobileThemeViewportForwarding(bus, events, getActiveTheme, getViewport) {
    return bus.on(events.VIEWPORT_RESIZED, () => {
        const theme = getActiveTheme();
        if (theme && typeof theme.resize === 'function') {
            const { width, height } = getViewport();
            theme.resize(width, height);
        }
    });
}

export function getMobileWebgl2PixelRatioCeiling(id, { quality, dpr, renderScale }) {
    if (id === 'serenity-warp') {
        const tier = normalizeQuality(quality);
        const budget = ['Minimal', 'Low'].includes(tier) ? 'LOW' : tier === 'Medium' ? 'MEDIUM' : 'HIGH';
        // The selectable adapter shares the intro's authored resolution policy.
        // Its portable profile caps DPR directly, independently of BaseTheme scale.
        return Math.min(dpr, getQualityBudget(getIntroVisualProfile(), budget).pixelRatio);
    }
    return computeScenePixelRatio({
        policy: null, sceneType: 'theme', qualityTier: quality,
        renderScale, devicePixelRatio: dpr,
    });
}

function finiteRange(value, fallback, min, max, name) {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`--${name} must be between ${min} and ${max}.`);
    }
    return number;
}

export function parseMobileWebgl2Args(argv, root = process.cwd(), env = process.env) {
    const values = {};
    const themes = [];
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--') continue;
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const equal = token.indexOf('=');
        const name = token.slice(2, equal === -1 ? undefined : equal);
        if (!VALUE_OPTIONS.has(name) && !BOOLEAN_OPTIONS.has(name)) {
            throw new Error(`Unknown option --${name}. Use --help.`);
        }
        if (name !== 'theme' && Object.hasOwn(values, name)) {
            throw new Error(`--${name} may only be specified once.`);
        }
        let value = equal === -1 ? undefined : token.slice(equal + 1);
        if (BOOLEAN_OPTIONS.has(name)) {
            if (value !== undefined) throw new Error(`--${name} does not take a value.`);
            value = true;
        } else if (value === undefined) {
            value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
            index += 1;
        }
        if (value === '') throw new Error(`--${name} requires a value.`);
        if (name === 'theme') themes.push(value);
        else values[name] = value;
    }
    if (values.all && themes.length) throw new Error('--all cannot be combined with --theme.');
    const quality = normalizeQuality(values.quality || 'Low');
    if (values.quality && !QUALITY_NAMES.some((name) => name.toLowerCase() === values.quality.toLowerCase())) {
        throw new Error(`Unknown quality: ${values.quality}`);
    }
    const selected = values.all ? THEME_REGISTRY.map(({ id }) => id)
        : [...new Set(themes.length ? themes : MOBILE_WEBGL2_SMOKE_IDS)];
    for (const id of selected) {
        if (!THEME_REGISTRY.some((entry) => entry.id === id)) throw new Error(`Unknown theme: ${id}`);
    }
    let chromiumArgs = [];
    if (env.PLAYWRIGHT_CHROMIUM_ARGS) {
        try { chromiumArgs = JSON.parse(env.PLAYWRIGHT_CHROMIUM_ARGS); }
        catch { throw new Error('PLAYWRIGHT_CHROMIUM_ARGS must be a JSON array of Chromium arguments.'); }
        if (!Array.isArray(chromiumArgs) || chromiumArgs.some((value) => typeof value !== 'string' || !value.startsWith('--'))) {
            throw new Error('PLAYWRIGHT_CHROMIUM_ARGS must be a JSON array of Chromium arguments.');
        }
    }
    const dpr = finiteRange(values.dpr, 3, 0.25, 4, 'dpr');
    const renderScale = finiteRange(values['render-scale'], getRenderScale(quality), 0.25, 2, 'render-scale');
    return {
        ids: selected,
        quality,
        dpr,
        renderScale,
        expectedMaxPixelRatio: getMobileWebgl2PixelRatioCeiling(null, { quality, dpr, renderScale }),
        out: path.resolve(root, values.out || 'artifacts/mobile-webgl2'),
        executable: values.executable || env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
        chromiumArgs,
        list: values.list === true,
        help: values.help === true,
    };
}

export function mobileWebgl2Failures(result) {
    const failures = [];
    if (result.failure) failures.push(result.failure);
    if (result.errors?.length) failures.push('Runtime or console errors.');
    if (result.requestFailures?.length) failures.push('Failed asset/module requests.');
    if (result.httpFailures?.length) failures.push('Asset/module HTTP failures.');
    if (result.warnings?.some((text) => /GL_INVALID|INVALID_[A-Z_]+|shader.*(?:compile|link)|material.*(?:incompatible|not compatible|not supported)|(?:incompatible|unsupported).*material/i.test(text))) {
        failures.push('Shader/material/WebGL validation warnings.');
    }
    for (const phase of ['portrait', 'effects', 'landscape']) {
        const state = result[phase];
        if (!state) {
            failures.push(`Missing ${phase} evidence.`);
            continue;
        }
        if (!state.ready || !state.active || state.runtimeFailure) failures.push(`${phase}: theme not running.`);
        if (state.raster?.uniform !== false) failures.push(`${phase}: missing or uniform screenshot.`);
        if (state.nonFinite > 0) failures.push(`${phase}: non-finite geometry or transforms.`);
        if (state.glError !== null && state.glError !== undefined && state.glError !== 0) failures.push(`${phase}: WebGL error ${state.glError}.`);
        if (!state.visibleContent) failures.push(`${phase}: no visible authored surface.`);
        if (state.quality && normalizeQuality(state.quality) !== result.quality) failures.push(`${phase}: requested ${result.quality}, rendered ${state.quality}.`);
        if (result.id === 'serenity-warp') {
            const expectedBudget = ['Minimal', 'Low'].includes(result.quality) ? 'LOW' : result.quality === 'Medium' ? 'MEDIUM' : 'HIGH';
            if (state.visualProfile?.performanceLevel !== expectedBudget) failures.push(`${phase}: intro visual quality budget must be ${expectedBudget}.`);
        }
        if (result.quality === 'Minimal') {
            for (const [key, expected] of Object.entries(MINIMAL_PRESET_EXPECTATIONS[result.id] || {})) {
                if (state.qualityPreset?.[key] !== expected) failures.push(`${phase}: Minimal budget ${key} must be ${expected}.`);
            }
            if (result.id === 'nebula-flow' && (state.qualityMultiplier !== 0.4
                || state.simulatorConfig?.SIM_RESOLUTION !== 128
                || state.simulatorConfig?.DYE_RESOLUTION !== 512
                || state.simulatorConfig?.PRESSURE_ITERATIONS !== 10)) {
                failures.push(`${phase}: Minimal fluid budget was not applied.`);
            }
        }
        if (/requires WebGPU|WebGPU required|No WebGPU support/i.test(state.fallbackText || '')) failures.push(`${phase}: unsupported-backend placeholder.`);
        if (MOBILE_WEBGL2_NODE_IDS.includes(result.id)
            && (state.rendererKind !== 'WebGPURenderer' || state.backend !== 'WebGL2' || state.nodeMaterials < 1)) {
            failures.push(`${phase}: modern node WebGL2 scene missing.`);
        }
        if (result.id === 'void-ember' && state.backend !== 'WebGL2') failures.push(`${phase}: authored raw WebGL2 hero missing.`);
        if (state.livenessRequired && !(state.heartbeat > 0)) failures.push(`${phase}: renderer did not advance.`);
        if (state.canvas && !(state.canvas.width > 0 && state.canvas.height > 0 && state.canvas.connected)) failures.push(`${phase}: renderer canvas missing.`);
        if (phase === 'landscape' && (state.viewport?.width !== 844 || state.viewport?.height !== 390)) failures.push('Landscape viewport did not rotate.');
        if (state.canvas && state.pixelRatio !== null && state.pixelRatio !== undefined) {
            if (!Number.isFinite(state.pixelRatio) || state.pixelRatio <= 0) failures.push(`${phase}: invalid effective pixel ratio.`);
            if (Number.isFinite(result.expectedMaxPixelRatio) && state.pixelRatio > result.expectedMaxPixelRatio + 0.01) {
                failures.push(`${phase}: effective DPR exceeds the selected tier's ${result.expectedMaxPixelRatio} ceiling.`);
            }
            if (Math.abs(state.canvas.width - Math.floor(state.viewport.width * state.pixelRatio)) > 1
                || Math.abs(state.canvas.height - Math.floor(state.viewport.height * state.pixelRatio)) > 1) {
                failures.push(`${phase}: drawing buffer did not follow viewport/effective DPR.`);
            }
        }
    }
    return [...new Set(failures)];
}

export function mobileWebgl2ExitCode(results, expectedCount) {
    return results.length === expectedCount && results.every((result) => result.status === 'pass') ? 0 : 1;
}
