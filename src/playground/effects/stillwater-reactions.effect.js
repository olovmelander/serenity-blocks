/**
 * Stillwater Wave 7 fixed reaction-pool pilot.
 *
 * Query examples:
 *   ?effect=stillwater-reactions&event=lock&t=8&fxAge=0.24
 *   ?effect=stillwater-reactions&event=tetris&t=8&fxAge=0.42
 *   ?effect=stillwater-reactions&event=tspin&t=8&fxAge=0.34
 *   ?effect=stillwater-reactions&event=perfect&t=8&fxAge=0.46
 */
import { createStillwaterReactions } from '../../themes/stillwater/rendering/stillwater-reactions.js';
import { getStillwaterQualityProfile } from '../../themes/stillwater/stillwater-quality.js';
import { create as createWater } from './stillwater-water.effect.js';

export const meta = {
    id: 'stillwater-reactions',
    title: 'Stillwater · The Pool Remembers',
    description: 'Fixed motes, tier-sized moon shafts, and one priority lake rune.',
};

const EVENTS = Object.freeze({
    lock: Object.freeze({
        method: 'dimple',
        water: 'lock',
        lineCount: 0,
        strength: 0.34,
        durationMs: 520,
        moteCount: 5,
        hue: 0.48,
    }),
    single: Object.freeze({
        method: 'wake',
        water: 'lock',
        lineCount: 1,
        strength: 0.44,
        durationMs: 620,
        moteCount: 8,
    }),
    double: Object.freeze({
        method: 'wake',
        water: 'lock',
        lineCount: 2,
        strength: 0.60,
        durationMs: 760,
        moteCount: 16,
    }),
    triple: Object.freeze({
        method: 'wake',
        water: 'tetris',
        lineCount: 3,
        strength: 0.78,
        durationMs: 920,
        moteCount: 24,
    }),
    tetris: Object.freeze({
        method: 'wake',
        water: 'tetris',
        lineCount: 4,
        strength: 1,
        durationMs: 1200,
        moteCount: 40,
    }),
    tspin: Object.freeze({
        method: 'twist',
        water: 'tspin',
        lineCount: 2,
        strength: 0.92,
        durationMs: 980,
        moteCount: 20,
    }),
    combo10: Object.freeze({
        method: 'miracle',
        water: 'tetris',
        lineCount: 4,
        strength: 0.92,
        durationMs: 1280,
        moteCount: 56,
    }),
    perfect: Object.freeze({
        method: 'miracle',
        water: 'tetris',
        lineCount: 4,
        strength: 1,
        durationMs: 1600,
        moteCount: 72,
    }),
    b2b: Object.freeze({
        method: 'echo',
        water: 'tspin',
        lineCount: 2,
        strength: 0.48,
        durationMs: 540,
        moteCount: 8,
    }),
});

function readFinite(params, key, fallback, minimum, maximum) {
    const value = Number(params?.get?.(key));
    if (!Number.isFinite(value)) return fallback;
    return Math.max(minimum, Math.min(maximum, value));
}
export function create(context) {
    const {
        scene,
        renderer,
        params,
    } = context;
    const qualityProfile = getStillwaterQualityProfile(
        params?.get?.('quality') || 'High',
    );
    const waterParams = new URLSearchParams();
    waterParams.set('quality', qualityProfile.name);
    waterParams.set('reflection', params?.get?.('reflection') || 'auto');
    waterParams.set('proxies', 'off');
    waterParams.set('post', 'off');
    waterParams.set('boardGuide', 'off');
    const water = createWater({ ...context, params: waterParams });
    const reactions = createStillwaterReactions({
        root: scene,
        qualityProfile,
        reducedMotion: params?.get?.('reducedMotion') === '1',
    });
    const requested = String(params?.get?.('event') || 'tetris').toLowerCase();
    const preset = EVENTS[requested] || EVENTS.tetris;
    const captureTime = readFinite(params, 't', 8, 0, 30);
    const age = readFinite(params, 'fxAge', 0.38, 0, 1.4);
    const options = {
        sequence: 1,
        originX: readFinite(params, 'originX', 0.5, 0, 1),
        originY: readFinite(params, 'originY', 0.62, 0, 1),
        strength: preset.strength,
        durationMs: preset.durationMs,
        moteCount: preset.moteCount,
        lineCount: preset.lineCount,
        cue: requested === 'perfect' ? 'stillwater-awakening' : undefined,
    };
    const waterOptions = {
        time: Math.max(0.0001, captureTime - age),
        x: (options.originX - 0.5) * 18,
        z: 1 - options.originY * 27,
    };
    const tideOptions = {
        strength: requested === 'combo10' || requested === 'perfect' ? 1 : 0.38,
    };

    reactions.update(Math.max(0, captureTime - age));
    reactions[preset.method](options);
    reactions.tide(tideOptions);
    water.triggerReaction(preset.water, waterOptions);
    reactions.update(captureTime);

    const debugApi = Object.freeze({
        pulse(eventName = requested) {
            const next = EVENTS[String(eventName).toLowerCase()] || preset;
            options.sequence += 1;
            options.strength = next.strength;
            options.durationMs = next.durationMs;
            options.moteCount = next.moteCount;
            options.lineCount = next.lineCount;
            reactions[next.method](options);
            waterOptions.time = Math.max(0.0001, captureTime);
            water.triggerReaction(next.water, waterOptions);
        },
        getDiagnostics: () => ({
            id: meta.id,
            wave: 7,
            event: requested,
            backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
            reactions: reactions.getDiagnostics(),
            water: water.getDiagnostics(),
        }),
        getResourceState: () => ({
            reactions: reactions.getResourceState(),
            water: water.getResourceState(),
        }),
    });
    window.__STILLWATER_REACTIONS__ = debugApi;

    return {
        ...debugApi,
        camera: water.camera,
        update(time, delta) {
            water.update(time, delta);
            reactions.update(time);
        },
        render: water.render,
        renderAsync: water.renderAsync,
        dispose() {
            if (window.__STILLWATER_REACTIONS__ === debugApi) {
                delete window.__STILLWATER_REACTIONS__;
            }
            reactions.dispose();
            water.dispose();
        },
    };
}
