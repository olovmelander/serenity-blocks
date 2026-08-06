/**
 * Source-level contracts for Cosmic Noir's opt-in performance telemetry.
 *
 * A real WebGPU device is not available in Vitest. These tripwires pin the
 * r181 renderer contract at the integration points while the browser harness
 * exercises the timestamp-query behavior end to end.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const themeSource = readFileSync(
    new URL('../../src/themes/cosmic-noir/cosmic-noir-theme.js', import.meta.url),
    'utf8',
);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);

    expect(start, `missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
    expect(end, `missing source marker: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('Cosmic Noir opt-in telemetry contract', () => {
    it('defaults High WebGPU to post-smoothed rendering without 4x MSAA', () => {
        const parserSource = sourceBetween(
            themeSource,
            'function parseCosmicNoirFlags() {',
            'function createSeededRandom(seed) {',
        );
        const presetsSource = sourceBetween(
            themeSource,
            'const QUALITY_PRESETS = {',
            'const ADAPTIVE_PIXEL_RATIO_CAPS = {',
        );
        const highPreset = sourceBetween(presetsSource, '    High: {', '    Medium: {');
        const ultraPreset = sourceBetween(presetsSource, '    Ultra: {', '    High: {');
        const initRendererSource = sourceBetween(
            themeSource,
            '    async initRenderer(container',
            '    createStarfield() {',
        );

        expect(parserSource).toMatch(/webgpuMsaa:\s*null/);
        expect(parserSource).toContain("webgpuMsaa: readOptionalBool('cosmicNoirMsaa')");
        expect(highPreset).toMatch(/enableWebGpuMsaa:\s*false/);
        expect(ultraPreset).toMatch(/enableWebGpuMsaa:\s*true/);
        expect(initRendererSource).toContain(
            'const webgpuAntialias = this.getWebGpuAntialiasEnabled();',
        );
        expect(initRendererSource).toMatch(/WebGPURenderer\(\{[\s\S]*?antialias:\s*webgpuAntialias/);
        expect(initRendererSource).toMatch(
            /WebGLRenderer\(\{[\s\S]*?antialias:\s*this\.getAntialiasEnabled\(\)/,
        );
    });

    it('parses perf and preserve-buffer flags independently of baseline capture', () => {
        const parserSource = sourceBetween(
            themeSource,
            'function parseCosmicNoirFlags() {',
            'function createSeededRandom(seed) {',
        );
        const refreshSource = sourceBetween(
            themeSource,
            '    refreshFlagsForScene() {',
            '    resetBaselineCapture() {',
        );

        expect(parserSource).toMatch(/perf:\s*false/);
        expect(parserSource).toMatch(/preserveDrawingBuffer:\s*false/);
        expect(parserSource).toMatch(
            /perf:\s*readBool\(\s*'cosmicNoirPerf'\s*,\s*'perf'\s*\)/,
        );
        expect(parserSource).toMatch(
            /preserveDrawingBuffer:\s*readBool\(\s*'cosmicNoirPreserveDrawingBuffer'\s*\)/,
        );
        expect(refreshSource).toMatch(
            /parsed\.perf\s*=\s*parsed\.perf\s*\|\|\s*previous\.perf\s*===\s*true/,
        );
        expect(refreshSource).toMatch(
            new RegExp([
                'parsed\\.preserveDrawingBuffer\\s*=\\s*',
                'parsed\\.preserveDrawingBuffer\\s*\\|\\|\\s*',
                'previous\\.preserveDrawingBuffer\\s*===\\s*true',
            ].join('')),
        );
    });

    it('enables WebGPU timestamp tracking only for perf or baseline sessions', () => {
        const initRendererSource = sourceBetween(
            themeSource,
            '    async initRenderer(container',
            '    createStarfield() {',
        );
        const constructorSource = sourceBetween(
            themeSource,
            '    constructor() {',
            '    getTetrominoConfig() {',
        );
        const webgpuOptionsSource = sourceBetween(
            initRendererSource,
            'new THREE_WEBGPU.WebGPURenderer({',
            'await this.initializeRendererCandidate(webgpuRenderer',
        );
        const webglOptionsSource = sourceBetween(
            initRendererSource,
            'renderer = new THREE.WebGLRenderer({',
            '            this.isWebGPU = false;',
        );

        expect(constructorSource).toMatch(
            /this\.performanceInstrumentationEnabled\s*=\s*this\.flags\.perf\s*\|\|\s*this\.flags\.baseline/,
        );
        expect(initRendererSource).toMatch(
            /const trackTimestamp\s*=\s*this\.performanceInstrumentationEnabled\s*===\s*true/,
        );
        expect(webgpuOptionsSource).toMatch(/\btrackTimestamp\s*,/);
        expect(webgpuOptionsSource).not.toMatch(/trackTimestamp:\s*true/);
        expect(webglOptionsSource).not.toContain('trackTimestamp');

        expect(initRendererSource).toMatch(
            /const preserveDrawingBuffer\s*=\s*this\.flags\.preserveDrawingBuffer\s*===\s*true/,
        );
        expect(initRendererSource).not.toMatch(
            /preserveDrawingBuffer\s*=\s*this\.flags\.baseline/,
        );
    });

    it('collects per-frame r181 counters rather than cumulative render calls', () => {
        const sampleSource = sourceBetween(
            themeSource,
            '    recordBaselineSample(',
            '    getBaselineReport() {',
        );
        const animateSource = sourceBetween(
            themeSource,
            '    animate() {',
            '    renderFrame() {',
        );

        expect(themeSource).toMatch(/this\.renderer\.info\.autoReset\s*=\s*!requested/);
        expect(sampleSource).toMatch(/\bdrawCalls\s*(?::|,)/);
        expect(sampleSource).toMatch(/renderPasses:\s*renderInfo\.frameCalls/);
        expect(sampleSource).toMatch(/computeCalls:\s*computeInfo\.frameCalls/);
        expect(sampleSource).toMatch(/renderInfo\.drawCalls/);
        expect(sampleSource).not.toMatch(/render\?*\.calls|render\.calls/);

        const resetMatches = [
            ...animateSource.matchAll(/this\.renderer\?*\.info\?*\.reset\(\)/g),
        ];
        expect(resetMatches).toHaveLength(1);
        expect(resetMatches[0].index).toBeLessThan(animateSource.indexOf('this.renderFrame()'));
    });

    it('resolves render and compute timestamps without blocking the animation loop', () => {
        const animateSource = sourceBetween(
            themeSource,
            '    animate() {',
            '    renderFrame() {',
        );

        expect(themeSource).toMatch(
            /resolveTimestampsAsync\(THREE_WEBGPU\.TimestampQuery\.RENDER\)/,
        );
        expect(themeSource).toMatch(
            /resolveTimestampsAsync\(THREE_WEBGPU\.TimestampQuery\.COMPUTE\)/,
        );
        expect(themeSource).toMatch(/state\?*\.enabled[\s\S]*?state\.pending[\s\S]*?return/);
        expect(themeSource).toMatch(/const pending\s*=\s*Promise\.all\s*\(/);
        expect(themeSource).toMatch(/state\.pending\s*=\s*pending/);
        expect(themeSource).toMatch(/renderFrameId\s*!==\s*state\.lastRenderFrameId/);
        expect(themeSource).toMatch(/computeFrameId\s*!==\s*state\.lastComputeFrameId/);
        expect(themeSource).toMatch(/if\s*\(!renderFrameIsNew\s*&&\s*!computeFrameIsNew\)\s*return/);
        expect(themeSource).toMatch(
            /\.finally\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?state\.pending\s*===\s*pending[\s\S]*?state\.pending\s*=\s*null/,
        );
        expect(animateSource).not.toMatch(/await\s+[^;\n]*Timestamp/i);
    });

    it('reports percentile GPU timings and the physical render-target dimensions', () => {
        const reportSource = sourceBetween(
            themeSource,
            '    getBaselineReport() {',
            '    downloadBaselineReport(',
        );
        const dimensionsSource = sourceBetween(
            themeSource,
            '    getPerformanceTargetDimensions() {',
            '    getBaselineReport() {',
        );

        expect(reportSource).toMatch(/gpuTiming:\s*\{/);
        expect(reportSource).toMatch(/renderMs:\s*(?:this\.)?[A-Za-z][A-Za-z0-9_]*/);
        expect(reportSource).toMatch(/computeMs:\s*(?:this\.)?[A-Za-z][A-Za-z0-9_]*/);

        for (const field of ['sampleCount', 'avgMs', 'p50Ms', 'p95Ms', 'p99Ms', 'maxMs']) {
            expect(themeSource).toMatch(new RegExp(`\\b${field}\\s*:`));
        }

        expect(reportSource).toMatch(
            /targetDimensions:\s*this\.getPerformanceTargetDimensions\(\)/,
        );
        for (const field of [
            'drawingBufferWidth',
            'drawingBufferHeight',
            'sceneWidth',
            'sceneHeight',
            'bloomWidth',
            'bloomHeight',
        ]) {
            expect(dimensionsSource).toMatch(new RegExp(`\\b${field}\\s*(?::|,)`));
        }
    });

    it('keeps compatibility samples and adds raw CPU/GPU telemetry arrays', () => {
        const helpersSource = sourceBetween(
            themeSource,
            '    installBaselineHelpers() {',
            '    removeBaselineHelpers() {',
        );
        const samplesMatch = helpersSource.match(
            /getSamples:\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)/,
        );

        expect(samplesMatch, 'missing cosmicNoirBaseline.getSamples() payload').not.toBeNull();
        const samplesSource = samplesMatch?.[1] ?? '';
        expect(samplesSource).toMatch(/\bframes:\s*\[\.\.\./);
        expect(samplesSource).toMatch(/\brender:\s*\[\.\.\./);
        expect(samplesSource).toMatch(/\bcpu:\s*\[\.\.\./);
        expect(samplesSource).toMatch(/\bgpu:\s*\[\.\.\./);
    });
});
