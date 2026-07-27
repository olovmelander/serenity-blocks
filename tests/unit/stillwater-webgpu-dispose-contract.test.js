import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backendSource = readFileSync(
    new URL(
        '../../node_modules/three/src/renderers/webgpu/WebGPUBackend.js',
        import.meta.url,
    ),
    'utf8',
);
const rendererSource = readFileSync(
    new URL(
        '../../node_modules/three/src/renderers/common/Renderer.js',
        import.meta.url,
    ),
    'utf8',
);
const animationSource = readFileSync(
    new URL(
        '../../node_modules/three/src/renderers/common/Animation.js',
        import.meta.url,
    ),
    'utf8',
);
const geometriesSource = readFileSync(
    new URL(
        '../../node_modules/three/src/renderers/common/Geometries.js',
        import.meta.url,
    ),
    'utf8',
);
const nodesSource = readFileSync(
    new URL(
        '../../node_modules/three/src/renderers/common/nodes/Nodes.js',
        import.meta.url,
    ),
    'utf8',
);
const stillwaterSource = readFileSync(
    new URL('../../src/themes/stillwater/stillwater-theme.js', import.meta.url),
    'utf8',
);
const validationSource = readFileSync(
    new URL('../../scripts/stillwater-wave8-validation.mjs', import.meta.url),
    'utf8',
);
const waterSource = readFileSync(
    new URL(
        '../../src/themes/stillwater/rendering/stillwater-water.js',
        import.meta.url,
    ),
    'utf8',
);

describe('Stillwater terminal WebGPU device disposal contract', () => {
    it('three r181 still captures its renderer in the device-loss promise', () => {
        expect(backendSource).toContain('device.lost.then( ( info ) => {');
        expect(backendSource).toContain('renderer.onDeviceLost( deviceLossInfo )');
    });

    it('WebGPUBackend.dispose still omits owned device destruction', () => {
        const disposeStart = backendSource.lastIndexOf('\tdispose()');
        const disposeEnd = backendSource.indexOf('\n\t}', disposeStart);
        expect(disposeStart).toBeGreaterThan(-1);
        expect(backendSource.slice(disposeStart, disposeEnd)).not.toContain('.destroy()');
    });

    it('Stillwater resolves the promise during terminal owned-renderer teardown', () => {
        expect(stillwaterSource).toContain('disposeOwnedRenderer(renderer');
        expect(stillwaterSource).toContain('renderer.onDeviceLost = () => {}');
        expect(stillwaterSource).toContain('device.destroy()');
        expect(stillwaterSource).toContain('backend.device = null');
    });

    it('pins the private r181 contracts used by the bounded renderer pool', () => {
        expect(rendererSource).toContain('this._renderLists = new RenderLists');
        expect(rendererSource).toContain('this._renderContexts = new RenderContexts');
        expect(rendererSource).toContain('this._bundles = new RenderBundles');
        expect(nodesSource).toContain('this.nodeFrame = new NodeFrame()');
        expect(geometriesSource).toContain('this._geometryDisposeListeners = new Map()');
        expect(geometriesSource).toContain(
            'this._geometryDisposeListeners.set( geometry, onDispose )',
        );
        expect(animationSource).toContain('start() {');
        expect(animationSource).toContain('stop() {');

        expect(stillwaterSource).toContain('resetPooledRendererTransientState');
        const strongSlotReset = stillwaterSource.indexOf('nodeFrame.scene = null');
        const nodeFrameReplacement = stillwaterSource.indexOf(
            'nodes.nodeFrame = new nodeFrame.constructor()',
        );
        expect(strongSlotReset).toBeGreaterThan(-1);
        expect(nodeFrameReplacement).toBeGreaterThan(strongSlotReset);
        expect(stillwaterSource).toContain('renderer._renderLists?.dispose?.()');
        expect(stillwaterSource).toContain('renderer._renderContexts?.dispose?.()');
        expect(stillwaterSource).toContain('renderer._bundles?.dispose?.()');
        expect(stillwaterSource).toContain(
            'renderer._geometries?._geometryDisposeListeners',
        );
        expect(stillwaterSource).toContain('renderer._animation?.stop?.()');
        expect(stillwaterSource).toContain('record.renderer._animation.start?.()');
        expect(stillwaterSource).toContain('if (drained && !record.terminal)');
    });

    it('pins the private r181 request state used by lifecycle pause diagnostics', () => {
        const start = animationSource.indexOf('\tstart()');
        const stop = animationSource.indexOf('\tstop()');
        const getAnimationLoop = animationSource.indexOf('\tgetAnimationLoop()');

        expect(start).toBeGreaterThan(-1);
        expect(stop).toBeGreaterThan(start);
        expect(animationSource.slice(start, stop)).toContain(
            'this._requestId = this._context.requestAnimationFrame( update )',
        );
        expect(animationSource.slice(stop, getAnimationLoop)).toContain(
            'this._requestId = null',
        );
        expect(stillwaterSource).toContain('rendererAnimationPausedByLifecycle');
        expect(stillwaterSource).toContain('rendererAnimationPauseStops');
        expect(stillwaterSource).toContain('rendererAnimationResumeStarts');
    });

    it('counts retained node materials from the common NodeMaterial prototype', () => {
        expect(validationSource).toContain(
            "!Object.prototype.hasOwnProperty.call(prototype, 'setupObserver')",
        );
        expect(validationSource).toContain('stillwaterNodeMaterialSamples');
    });

    it('detaches reflector samplers from the immortal r181 placeholder texture', () => {
        expect(waterSource).toContain('reflectionDefaultDisposeListeners = new Set');
        expect(waterSource).toContain('rendererTextureDisposeListener');
        expect(waterSource).toContain(
            "reflectionDefaultTexture?.removeEventListener?.('dispose', listener)",
        );
    });
});
