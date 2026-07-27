/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Single-clock production facade for Koi Pond.
 *
 * The BaseTheme wrapper owns the renderer and RAF. This runtime owns every
 * visual subsystem, routes complete gameplay payloads, drains bounded commands
 * once per update, and disposes in reverse dependency order.
 */
import { KoiPondGameplayRouting, KOI_POND_FX_COMMAND } from '../koi-pond-gameplay-routing.js';
import { createKoiPondCameraDirector } from './koi-pond-camera.js';
import { createKoiPondGameplayFX } from './koi-pond-gameplay-fx.js';
import { createKoiPondLandscape } from './koi-pond-landscape.js';
import {
    KOI_POND_LAYOUT,
    mapKoiPondSideLaneToWorld,
    normalizeKoiPondQuality,
} from './koi-pond-layout.js';
import { createKoiPondWater } from './koi-pond-water.js';

const ROUTED_EVENTS = new Set(['PIECE_LOCK', 'pieceLock', 'COMBO', 'combo']);

function readBooleanParam(params, key) {
    if (!params?.has?.(key)) return null;
    const value = params.get(key);
    if (value === null || value === '') return true;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function createWaterParams(params, quality, reducedMotion = false) {
    const waterParams = new URLSearchParams(params?.toString?.() || '');
    const explicit = readBooleanParam(params, 'koiReflection')
        ?? readBooleanParam(params, 'reflection');
    const defaultEnabled = quality === 'Ultra' || quality === 'Extreme';
    // A near-static reduced-motion pond does not need a live planar reflection
    // subpass; dropping it reclaims a whole scene render for that accessibility path.
    const enabled = reducedMotion ? false : (explicit ?? defaultEnabled);
    waterParams.set('reflection', enabled ? '1' : '0');
    waterParams.set('quality', quality);
    return waterParams;
}

function rendererCounters(renderer) {
    const info = renderer?.info;
    const render = info?.render;
    return {
        drawCalls: render?.drawCalls ?? render?.calls ?? 0,
        renderCalls: render?.calls ?? 0,
        frameCalls: render?.frameCalls ?? 0,
        triangles: render?.triangles ?? 0,
        lines: render?.lines ?? 0,
        points: render?.points ?? 0,
        geometries: info?.memory?.geometries ?? 0,
        textures: info?.memory?.textures ?? 0,
    };
}

export function createKoiPondRuntime({
    scene,
    camera,
    renderer,
    params = new URLSearchParams(),
    quality = 'High',
    reducedMotion = false,
    intensity = 1,
} = {}) {
    if (!scene?.add || !camera || !renderer) {
        throw new TypeError('Koi Pond runtime requires scene, camera, and renderer');
    }

    const renderQuality = normalizeKoiPondQuality(quality);
    let requestedQuality = renderQuality;
    let currentTime = 0;
    let routerClockMs = 0;
    let disposed = false;

    let water = null;
    let landscape = null;
    let routing = null;
    let gameplayFx = null;
    let cameraDirector = null;

    try {
        cameraDirector = createKoiPondCameraDirector({
            camera,
            reducedMotion,
        });
        water = createKoiPondWater({
            scene,
            camera,
            renderer,
            params: createWaterParams(params, renderQuality, reducedMotion),
            quality: renderQuality,
            reducedMotion,
        });
        landscape = createKoiPondLandscape({
            scene,
            quality: renderQuality,
            reducedMotion,
            intensity,
        });
        routing = new KoiPondGameplayRouting({
            clock: () => routerClockMs,
            reducedMotion,
            // Gameplay FX owns the continuous master intensity. Routing only
            // needs a binary gate so authored command strength is not multiplied
            // by the same setting twice in the shader.
            intensityMultiplier: Number(intensity) > 0 ? 1 : 0,
        });
        gameplayFx = createKoiPondGameplayFX({
            scene,
            isWebGPU: renderer.backend?.isWebGPUBackend === true,
            quality: renderQuality,
            reducedMotion,
            intensity,
            pondCenter: KOI_POND_LAYOUT.gameplayCenter,
            pondRadii: KOI_POND_LAYOUT.gameplayRadii,
        });
    } catch (error) {
        // Runtime construction is transactional: a later subsystem failure
        // must not strand earlier GPU resources or a live gameplay router.
        try { gameplayFx?.dispose?.(); } catch (disposeError) { /* noop */ }
        try { routing?.dispose?.(); } catch (disposeError) { /* noop */ }
        try { landscape?.dispose?.(); } catch (disposeError) { /* noop */ }
        try { water?.dispose?.(); } catch (disposeError) { /* noop */ }
        try { cameraDirector?.dispose?.(); } catch (disposeError) { /* noop */ }
        throw error;
    }

    function drainGameplayCommands() {
        const commands = routing.drainCommands();
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            const worldOrigin = mapKoiPondSideLaneToWorld(command.origin);
            gameplayFx.enqueue({
                ...command,
                birthTime: command.issuedAtMs / 1000,
                cellSize: 0.86,
                worldOrigin,
            });
            // Also disturb the real water surface so the reaction bends the
            // mirrored moon and caustics — a ripple of chi, not an overlay.
            const isCombo = command.type === KOI_POND_FX_COMMAND.COMBO;
            const tier = Number(command.tier) || 1;
            const rippleOrigin = isCombo
                ? KOI_POND_LAYOUT.gameplayCenter
                : worldOrigin;
            water.injectRipple?.({
                x: rippleOrigin.x,
                z: rippleOrigin.z,
                strength: isCombo ? Math.min(1.4, 0.85 + tier * 0.12) : 0.78,
                time: command.issuedAtMs / 1000,
            });
        }
        return commands.length;
    }

    const debugApi = Object.freeze({
        getDiagnostics() {
            const fxState = gameplayFx.getDebugState();
            return {
                quality: renderQuality,
                requestedQuality,
                requiresRebuild: requestedQuality !== renderQuality,
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                time: currentTime,
                water: water.getDiagnostics?.() || null,
                landscape: landscape.getDiagnostics?.() || null,
                camera: cameraDirector.getDiagnostics(),
                routing: routing.getState(),
                gameplayFx: fxState,
                renderer: rendererCounters(renderer),
                disposed,
            };
        },
    });

    if (typeof window !== 'undefined') window.__KOI_POND_RUNTIME__ = debugApi;

    return {
        pulse(eventName, payload = {}) {
            if (disposed) return null;
            routerClockMs = currentTime * 1000;
            landscape.pulse(eventName, payload);
            return ROUTED_EVENTS.has(eventName)
                ? routing.dispatch(eventName, payload)
                : null;
        },
        setQuality(value) {
            if (disposed) return false;
            // Water geometry, wave/caustic node graphs, refraction, reflection,
            // pixel ratio, and AA are construction-time decisions. Reporting a
            // live quality mutation here would let diagnostics drift away from
            // the actual render path, so callers receive an explicit rebuild
            // boundary instead.
            requestedQuality = normalizeKoiPondQuality(value);
            return requestedQuality !== renderQuality;
        },
        configureGameplay({
            quality: nextQuality,
            reducedMotion: nextReducedMotion,
            intensity: nextIntensity,
        } = {}) {
            if (disposed) return;
            if (nextQuality !== undefined) this.setQuality(nextQuality);
            if (nextReducedMotion !== undefined) {
                const reduced = nextReducedMotion === true;
                routing.setReducedMotion(reduced);
                gameplayFx.setReducedMotion(reduced);
                landscape.setReducedMotion(reduced);
                water.setReducedMotion?.(reduced);
                cameraDirector.setReducedMotion(reduced);
            }
            if (nextIntensity !== undefined) {
                const multiplier = Math.max(0, Math.min(2, Number(nextIntensity) || 0));
                routing.setIntensityMultiplier(multiplier > 0 ? 1 : 0);
                gameplayFx.setIntensity(multiplier);
                landscape.setIntensity(multiplier);
            }
        },
        camera(time, activeCamera = camera) {
            if (disposed) return;
            cameraDirector.apply(activeCamera);
        },
        setPointer(x, y, options) {
            if (disposed) return;
            cameraDirector.setPointer(x, y, options);
        },
        resetPointer(options) {
            if (disposed) return;
            cameraDirector.reset(options);
        },
        resize(width, height) {
            if (disposed) return;
            water.resize?.(width, height);
            cameraDirector.apply(camera);
        },
        update(time, delta = 1 / 60) {
            if (disposed) return false;
            const sampledTime = Number.isFinite(time) ? Number(time) : currentTime;
            currentTime = Math.max(currentTime, sampledTime);
            routerClockMs = currentTime * 1000;
            const safeDelta = Number.isFinite(delta)
                ? Math.max(0, Math.min(Number(delta), 0.1))
                : 1 / 60;

            cameraDirector.update(currentTime, safeDelta);
            const drained = drainGameplayCommands();
            water.update?.(currentTime, safeDelta);
            landscape.update(currentTime, safeDelta);
            gameplayFx.update(currentTime, safeDelta);
            return drained > 0 || gameplayFx.hasActiveEffects();
        },
        prepareForCompile() {
            if (disposed) return () => {};
            return gameplayFx.prepareForCompile();
        },
        getDiagnostics: debugApi.getDiagnostics,
        getRendererCounters() {
            const fxState = gameplayFx.getDebugState();
            return {
                ...rendererCounters(renderer),
                effectActiveDraws: fxState.activeDraws,
                effectActiveParticles: fxState.activeInstances,
                effectSubmittedInstances: fxState.submittedInstances,
            };
        },
        getActiveParticleCount() {
            return landscape.getActiveParticleCount() + gameplayFx.getActiveParticleCount();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (typeof window !== 'undefined' && window.__KOI_POND_RUNTIME__ === debugApi) {
                delete window.__KOI_POND_RUNTIME__;
            }
            const disposalErrors = [];
            [
                ['gameplay FX', gameplayFx],
                ['routing', routing],
                ['landscape', landscape],
                ['water', water],
                ['camera director', cameraDirector],
            ].forEach(([label, subsystem]) => {
                try {
                    subsystem?.dispose?.();
                } catch (error) {
                    disposalErrors.push(new Error(`Koi Pond ${label} cleanup failed`, {
                        cause: error,
                    }));
                }
            });
            if (disposalErrors.length > 0) {
                throw new AggregateError(
                    disposalErrors,
                    'Koi Pond runtime cleanup was incomplete',
                );
            }
        },
    };
}

export default createKoiPondRuntime;
