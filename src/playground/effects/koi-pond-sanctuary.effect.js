/**
 * Playground proof for the unified production Koi Pond runtime.
 *
 *   ?effect=koi-pond-sanctuary&quality=High&orbit=0&t=12
 *   ?effect=koi-pond-sanctuary&event=lock&piece=T&rotation=0&fxAge=.22&orbit=0&t=12
 *   ?effect=koi-pond-sanctuary&event=combo&combo=10&fxAge=.48&orbit=0&t=12
 *   ?effect=koi-pond-sanctuary&quality=Low&reducedMotion=1&orbit=0&t=12
 */
import { createKoiPondRuntime } from '../../themes/koi-pond/rendering/koi-pond-runtime.js';
import { normalizeKoiPondQuality } from '../../themes/koi-pond/rendering/koi-pond-layout.js';

export const meta = {
    id: 'koi-pond-sanctuary',
    title: 'Koi Pond v2 — Unified Moonwake Sanctuary',
    description: 'Production black-jade pond, moonlit landscape, spirit witness, and gameplay reactions.',
};

const SHAPES = Object.freeze({
    I: Object.freeze([Object.freeze([1, 1, 1, 1])]),
    O: Object.freeze([Object.freeze([1, 1]), Object.freeze([1, 1])]),
    T: Object.freeze([Object.freeze([1, 1, 1]), Object.freeze([0, 1, 0])]),
    S: Object.freeze([Object.freeze([0, 1, 1]), Object.freeze([1, 1, 0])]),
    Z: Object.freeze([Object.freeze([1, 1, 0]), Object.freeze([0, 1, 1])]),
    J: Object.freeze([Object.freeze([1, 1, 1]), Object.freeze([0, 0, 1])]),
    L: Object.freeze([Object.freeze([1, 1, 1]), Object.freeze([1, 0, 0])]),
});

function readNumber(params, key, fallback) {
    const value = Number(params?.get?.(key));
    return Number.isFinite(value) ? value : fallback;
}

function readBoolean(params, key) {
    if (!params?.has?.(key)) return false;
    const value = params.get(key);
    return value === null || value === ''
        || ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function rotateShape(shape) {
    const height = shape.length;
    const width = shape[0]?.length || 0;
    return Array.from(
        { length: width },
        (_, row) => Array.from({ length: height }, (__, col) => shape[height - col - 1][row]),
    );
}

function makePiece(params) {
    const requestedType = String(params?.get?.('piece') || 'T').trim().toUpperCase();
    const type = SHAPES[requestedType] ? requestedType : 'T';
    const rotation = Math.floor(readNumber(params, 'rotation', 0));
    let shape = SHAPES[type].map((row) => row.slice());
    const turns = ((rotation % 4) + 4) % 4;
    for (let turn = 0; turn < turns; turn += 1) shape = rotateShape(shape);
    return {
        type,
        shape,
        rotation,
        x: readNumber(params, 'col', 4),
        y: readNumber(params, 'row', 17),
        pieceId: `playground-sanctuary-${type}-${rotation}`,
    };
}

export function create({
    scene, camera, renderer, params, quality: requestedQuality,
}) {
    const quality = normalizeKoiPondQuality(
        params?.get?.('quality') || requestedQuality || 'High',
    );
    const reducedMotion = readBoolean(params, 'reducedMotion')
        || readBoolean(params, 'reduced');
    const eventName = String(params?.get?.('event') || 'idle').trim().toLowerCase();
    const fxAge = Math.max(
        0.001,
        readNumber(params, 'fxAge', eventName === 'lock' ? 0.22 : 0.48),
    );
    const comboCount = Math.max(2, Math.floor(readNumber(params, 'combo', 10)));
    const pointerX = Math.max(-1, Math.min(1, readNumber(params, 'pointerX', 0)));
    const pointerY = Math.max(-1, Math.min(1, readNumber(params, 'pointerY', 0)));

    const runtime = createKoiPondRuntime({
        scene,
        camera,
        renderer,
        params,
        quality,
        reducedMotion,
        intensity: 1,
    });

    let seeded = false;
    let cameraConfigured = false;
    runtime.setPointer(pointerX, pointerY, {
        immediate: params.has('pointerX') || params.has('pointerY'),
    });

    function seed(time) {
        const birthTime = Math.max(0.0001, time - fxAge);
        runtime.update(birthTime, 0);
        if (eventName === 'lock' || eventName === 'combo') {
            const lockPayload = { piece: makePiece(params), player: 0 };
            runtime.pulse('PIECE_LOCK', lockPayload);
            if (eventName === 'combo') {
                runtime.pulse('COMBO', { comboCount, player: 0 });
            }
        } else if (eventName === 'lineclear') {
            runtime.pulse('LINE_CLEAR', {
                lineCount: Math.max(1, Math.min(4, Math.floor(readNumber(params, 'lines', 4)))),
                clearedRows: [],
                cascadeCount: 1,
                player: 0,
            });
        }
        runtime.update(time, fxAge);
        seeded = true;
    }

    return {
        cameraRadius: 34,
        camera(time, activeCamera) {
            if (cameraConfigured) return;
            runtime.camera(time, activeCamera);
            cameraConfigured = true;
        },
        update(time, delta) {
            if (!seeded) seed(time);
            runtime.update(time, delta);
        },
        resize(width, height) {
            cameraConfigured = false;
            runtime.resize(width, height);
        },
        getCaptureMeta() {
            return {
                event: eventName,
                quality,
                reducedMotion,
                comboMilestones: [2, 4, 7, 10],
                recommendedFxAges: eventName === 'lock'
                    ? [0.06, 0.22, 0.44]
                    : [0.20, 0.48, 0.82],
                productionRuntime: true,
                pointer: { x: pointerX, y: pointerY },
            };
        },
        getDiagnostics: runtime.getDiagnostics,
        getRendererCounters: runtime.getRendererCounters,
        getActiveParticleCount: runtime.getActiveParticleCount,
        dispose() {
            runtime.dispose();
        },
    };
}
