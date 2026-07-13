/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Serenity Warp gameplay reactions — deterministic playground composition.
 *
 * URL examples:
 *   ?effect=serenity-warp-reactions&event=lock&t=0.24&orbit=0
 *   ?effect=serenity-warp-reactions&event=combo10&t=0.72&quality=high&orbit=0
 *   ?effect=serenity-warp-reactions&event=tspin&t=0.38&reducedMotion=1&orbit=0
 *
 * The production reaction renderer owns no post pass, so this wrapper deliberately
 * reuses the single post-processing pipeline from the Serenity Warp composition.
 */
import { create as createSerenityWarpBackdrop } from './serenity-warp.effect.js';
import { createSerenityWarpGameplayFX } from '../../themes/serenity-warp/serenity-warp-gameplay-fx.js';
import {
    SERENITY_WARP_FX_COMMAND,
    SerenityWarpFXController,
} from '../../themes/serenity-warp/serenity-warp-fx-controller.js';

export const meta = {
    id: 'serenity-warp-reactions',
    title: 'Serenity Warp — Reactions',
    description: 'Phase Seal locks, Spectrum Gate combos, and cosmic special-clear accents.',
};

const LOCK_ORIGIN = Object.freeze({ x: -9.4, y: -2.4, z: 1.5 });
const GATE_ORIGIN = Object.freeze({ x: 0, y: -0.4, z: 1.2 });
const LOCK_PAYLOAD = Object.freeze({
    player: 0,
    piece: Object.freeze({
        shapeKey: 'T',
        color: 0x536dff,
        rotation: 0,
        pieceId: 'playground-t',
        x: 3,
        y: 17,
        shape: Object.freeze([
            Object.freeze([1, 1, 1]),
            Object.freeze([0, 1, 0]),
        ]),
    }),
});

const VALID_SCENARIOS = new Set([
    'lock',
    'combo2',
    'combo3',
    'combo6',
    'combo10',
    'tspin',
    'perfect',
]);

function normalizeScenario(value) {
    const normalized = String(value || 'lock')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, '');
    if (normalized === 'perfectclear') return 'perfect';
    return VALID_SCENARIOS.has(normalized) ? normalized : 'lock';
}

function normalizeQuality(value) {
    const normalized = String(value || 'high').trim().toLowerCase();
    if (normalized === 'minimal' || normalized === 'low') return 'Low';
    if (normalized === 'medium') return 'Medium';
    return 'High';
}

function readBoolean(value) {
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function emitScenario(controller, scenario) {
    // Every gameplay reaction follows a real lock in the game. Seeding the controller
    // this way exercises exact rotated glyph extraction and gives later commands the
    // same cached origin/seal history that production receives.
    controller.dispatch('pieceLock', LOCK_PAYLOAD);
    if (scenario.startsWith('combo')) {
        controller.dispatch('combo', {
            player: LOCK_PAYLOAD.player,
            comboCount: Number.parseInt(scenario.slice(5), 10),
        });
    } else if (scenario === 'tspin') {
        controller.dispatch('tspin', { player: LOCK_PAYLOAD.player, lineCount: 2 });
    } else if (scenario === 'perfect') {
        controller.dispatch('perfectClear', { player: LOCK_PAYLOAD.player, depth: 1 });
    }
}

function enqueueControllerCommands(controller, fx) {
    const commands = controller.drainCommands();
    for (let index = 0; index < commands.length; index += 1) {
        const command = commands[index];
        command.origin = command.type === SERENITY_WARP_FX_COMMAND.PHASE_SEAL
            ? LOCK_ORIGIN
            : GATE_ORIGIN;
        fx.enqueue(command);
    }
}

export function create({
    scene,
    camera,
    renderer,
    params,
}) {
    const backdrop = createSerenityWarpBackdrop({ scene, camera, renderer });
    const scenario = normalizeScenario(params?.get('event'));
    const quality = normalizeQuality(params?.get('quality'));
    const reducedMotion = readBoolean(
        params?.get('reducedMotion') ?? params?.get('reduced'),
    );
    const controller = new SerenityWarpFXController({
        clock: () => 0,
        reducedMotion,
    });
    const fx = createSerenityWarpGameplayFX({
        scene,
        camera,
        isWebGPU: renderer?.backend?.isWebGPUBackend === true,
        quality,
        reducedMotion,
    });

    // Commands are born at exactly t=0 before the harness applies a fixed capture time.
    // The renderer consumes authoritative time, so a `?t=` URL samples the true envelope
    // instead of spawning the reaction on the screenshot frame.
    emitScenario(controller, scenario);
    enqueueControllerCommands(controller, fx);
    fx.update(0);

    return {
        cameraRadius: backdrop.cameraRadius,
        camera(time, activeCamera) {
            backdrop.camera?.(time, activeCamera);
        },
        update(authoritativeTime, delta) {
            backdrop.update?.(authoritativeTime, delta);
            fx.update(authoritativeTime, delta);
        },
        render() {
            backdrop.render?.();
        },
        renderAsync() {
            if (backdrop.renderAsync) return backdrop.renderAsync();
            backdrop.render?.();
            return Promise.resolve();
        },
        resize(width, height) {
            backdrop.resize?.(width, height);
        },
        getDiagnostics() {
            return {
                scenario,
                quality,
                reducedMotion,
                controller: controller.getState(),
                reactions: fx.getDebugState(),
            };
        },
        dispose() {
            controller.dispose();
            fx.dispose();
            backdrop.dispose?.();
        },
    };
}
