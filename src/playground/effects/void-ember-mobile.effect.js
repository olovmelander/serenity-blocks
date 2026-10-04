import VoidEmberTheme from '../../themes/void-ember/void-ember-theme.js';
import { VoidEmberWebGL2Renderer } from '../../themes/void-ember/void-ember-webgl2.js';
import { createVoidEmberUniformData } from '../../themes/void-ember/void-ember-uniforms.js';
import { getVoidEmberAnchor } from '../../themes/void-ember/void-ember-composition.js';
import { getVoidEmberPresetFromEffectQuality } from '../../themes/void-ember/void-ember-presets.js';

export const meta = {
    id: 'void-ember-mobile',
    title: 'Void Ember — modern WebGL2 star',
    description: 'Current granulated star, corona, prominences and deep-space environment without compute.',
};

export function create({ renderer, params }) {
    const theme = new VoidEmberTheme();
    theme.qualityPreset = getVoidEmberPresetFromEffectQuality(params.get('quality') || 'Low');
    theme.currentTier = theme.qualityPreset.id;
    const sourceCanvas = renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    sourceCanvas.parentNode.appendChild(canvas);
    const oldVisibility = sourceCanvas.style.visibility;
    sourceCanvas.style.visibility = 'hidden';
    theme.canvas = canvas;
    const compatible = VoidEmberWebGL2Renderer.create(canvas);
    if (!compatible) throw new Error('Void Ember playground requires WebGL2');
    window.__VOID_EMBER_WEBGL2__ = compatible;
    let previousTime = null;
    let didBurst = false;
    const resize = () => {
        canvas.width = Math.max(1, Math.round(sourceCanvas.width * theme.qualityPreset.renderScale));
        canvas.height = Math.max(1, Math.round(sourceCanvas.height * theme.qualityPreset.renderScale));
        compatible.resize();
    };
    resize();
    return {
        update(time) {
            if (previousTime === null) {
                // Warm the pure conductor to the requested fixed capture phase.
                for (let elapsed = 0; elapsed < time; elapsed += 0.05) {
                    theme.stellarConductor.update(Math.min(0.05, time - elapsed));
                }
                previousTime = time;
            }
            const delta = Math.min(0.05, Math.max(0, time - previousTime));
            previousTime = time;
            theme.runtime.time = time;
            theme.runtime.delta = delta;
            theme.frameCounter += 1;
            theme.updateReactiveState(delta);
            theme.stellarConductor.update(delta);
            if (params.get('burst') === '1' && !didBurst) {
                didBurst = true;
                theme.runtime.flare = 0.8;
                theme.runtime.shockwave = 0.6;
                theme.stellarConductor.onLineClear(4);
            }
        },
        render() {
            compatible.render(createVoidEmberUniformData({
                canvas,
                runtime: theme.runtime,
                frameCounter: theme.frameCounter,
                qualityPreset: theme.qualityPreset,
                currentTier: theme.currentTier,
                anchor: getVoidEmberAnchor(theme.runtime.time, canvas.width / canvas.height),
                colors: theme.getEmberColors(),
                conductor: theme.stellarConductor,
            }));
        },
        resize,
        dispose() {
            compatible.dispose();
            canvas.remove();
            sourceCanvas.style.visibility = oldVisibility;
            delete window.__VOID_EMBER_WEBGL2__;
        },
    };
}
