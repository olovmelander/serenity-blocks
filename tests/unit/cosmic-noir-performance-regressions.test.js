/**
 * Source-level regression tripwires for the first Cosmic Noir performance batch.
 *
 * Cosmic Noir's WebGPU post stack and particle systems require a browser GPU to
 * instantiate. These checks intentionally inspect only the affected method bodies,
 * following the source-tripwire convention used elsewhere in the unit suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import CosmicNoirTheme from '../../src/themes/cosmic-noir/cosmic-noir-theme.js';

const postSource = readFileSync(
    new URL('../../src/themes/cosmic-noir/cosmic-noir-post.js', import.meta.url),
    'utf8'
);
const themeSource = readFileSync(
    new URL('../../src/themes/cosmic-noir/cosmic-noir-theme.js', import.meta.url),
    'utf8'
);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);

    expect(start, `missing source marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
    expect(end, `missing source marker: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('Cosmic Noir performance regressions', () => {
    it('uses the PassNode resolution-scale API without manual target sizing', () => {
        const setSizeSource = sourceBetween(
            postSource,
            '    setSize(width, height) {',
            '    dispose() {'
        );

        expect(postSource).toMatch(
            /this\.scenePass\.setResolutionScale\(\s*this\.resolutionScale\s*\)/
        );
        expect(setSizeSource).not.toContain('this.scenePass.setSize(');
        expect(setSizeSource).not.toContain('this.bloomNode.setSize(');
    });

    it('keeps gas and unified fallback attributes out of DynamicDrawUsage', () => {
        const gasCreationSource = sourceBetween(
            themeSource,
            '    createGasSwirlParticles() {',
            '    triggerGasSwirlBurst(comboCount) {'
        );
        const voidSparkCreationSource = sourceBetween(
            themeSource,
            '    createVoidSparks() {',
            '    triggerUnifiedVoidSparkBurst(comboCount, burstIndex = 0, intensity = 1.0) {'
        );

        expect(gasCreationSource).not.toContain('THREE.DynamicDrawUsage');
        expect(voidSparkCreationSource).not.toContain('THREE.DynamicDrawUsage');
    });

    it('still uploads only changed gas and fallback attribute ranges', () => {
        const rangeHelperSource = sourceBetween(
            themeSource,
            '    markAttributeRange(attribute, startIndex, itemCount) {',
            '    applyAdaptiveLodState(force = false) {'
        );
        const gasBurstSource = sourceBetween(
            themeSource,
            '    triggerGasSwirlBurst(comboCount) {',
            '    updateGasSwirlParticles() {'
        );
        const fallbackBurstSource = sourceBetween(
            themeSource,
            '    triggerUnifiedVoidSparkBurst(comboCount, burstIndex = 0, intensity = 1.0) {',
            '    updateUnifiedVoidSparks() {'
        );

        expect(rangeHelperSource).toMatch(
            /attribute\.addUpdateRange\(startIndex \* itemSize, itemCount \* itemSize\)/
        );
        expect(rangeHelperSource).toMatch(/attribute\.needsUpdate = true/);
        expect(gasBurstSource).toContain('this.markGeometryAttributeRange(this.gasSwirl.geometry');
        expect(fallbackBurstSource).toContain('this.markGeometryAttributeRange(geometry');
    });

    it.each([true, false])('lets node post own its clear on native=%s, and clears direct rendering', (isWebGPU) => {
        const renderer = { clear: vi.fn(), render: vi.fn() };
        const postProcessing = { render: vi.fn() };
        const theme = {
            renderer, scene: {}, camera: {}, usesNodeMaterials: true, isWebGPU,
            postProcessing, flags: { usePost: true },
        };
        CosmicNoirTheme.prototype.renderFrame.call(theme);
        expect(postProcessing.render).toHaveBeenCalledOnce();
        expect(renderer.clear).not.toHaveBeenCalled();
        expect(renderer.render).not.toHaveBeenCalled();

        theme.flags.usePost = false;
        CosmicNoirTheme.prototype.renderFrame.call(theme);
        expect(renderer.clear).toHaveBeenCalledOnce();
        expect(renderer.render).toHaveBeenCalledWith(theme.scene, theme.camera);
        expect(renderer.clear.mock.invocationCallOrder[0]).toBeLessThan(renderer.render.mock.invocationCallOrder[0]);
    });

    it('resets transient pool ranges only after all active windows expire', () => {
        const gasUpdateSource = sourceBetween(
            themeSource,
            '    updateGasSwirlParticles() {',
            '    createVoidSparks() {'
        );
        const fallbackUpdateSource = sourceBetween(
            themeSource,
            '    updateUnifiedVoidSparks() {',
            '    setupPostProcessing() {'
        );

        for (const updateSource of [gasUpdateSource, fallbackUpdateSource]) {
            expect(updateSource).toContain('d.highWaterMark = 0;');
            expect(updateSource).toContain('d.nextIndex = 0;');
        }
        expect(fallbackUpdateSource).not.toContain('.filter(');
        expect(fallbackUpdateSource).not.toContain('.reduce(');
    });
});
