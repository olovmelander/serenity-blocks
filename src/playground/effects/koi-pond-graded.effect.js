/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond v2 — Graded Sanctuary (Wave 1 keystone proof).
 *
 * Wraps the production runtime AND the new post chain (AgX + threshold bloom +
 * split-tone + vignette) so the "authored-for-bloom" glows finally read.
 *
 *   ?effect=koi-pond-graded&quality=High&orbit=0&t=12
 *   ?effect=koi-pond-graded&quality=High&orbit=0&t=12&post=0     (A/B: bloom OFF)
 *   ?effect=koi-pond-graded&event=lock&piece=T&fxAge=.22&orbit=0&t=12
 *   ?effect=koi-pond-graded&event=combo&combo=10&fxAge=.48&orbit=0&t=12
 *
 * Live tuning: window.__KOI_POST__.update({ bloomStrength, exposure, ... })
 */
import * as THREE from 'three/webgpu';
import { createKoiPondRuntime } from '../../themes/koi-pond/rendering/koi-pond-runtime.js';
import { normalizeKoiPondQuality } from '../../themes/koi-pond/rendering/koi-pond-layout.js';
import { KoiPondPost, getKoiPondPostProfile } from '../../themes/koi-pond/rendering/koi-pond-post.js';

export const meta = {
    id: 'koi-pond-graded',
    title: 'Koi Pond v2 — Graded Sanctuary (AgX + Bloom)',
    description: 'Production pond through the Wave-1 post keystone: AgX grade, threshold bloom, split-tone, vignette.',
};

const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[1, 1, 1], [0, 1, 0]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 1, 1], [0, 0, 1]],
    L: [[1, 1, 1], [1, 0, 0]],
});

function readNumber(params, key, fallback) {
    const value = Number(params?.get?.(key));
    return Number.isFinite(value) ? value : fallback;
}

function readBoolean(params, key, fallback = false) {
    if (!params?.has?.(key)) return fallback;
    const value = params.get(key);
    if (value === null || value === '') return true;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
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
        pieceId: `graded-${type}-${rotation}`,
    };
}

export function create({
    scene, camera, renderer, params, sizes, quality: requestedQuality,
}) {
    const quality = normalizeKoiPondQuality(params?.get?.('quality') || requestedQuality || 'High');
    const reducedMotion = readBoolean(params, 'reducedMotion') || readBoolean(params, 'reduced');
    const postEnabled = readBoolean(params, 'post', true);
    const eventName = String(params?.get?.('event') || 'idle').trim().toLowerCase();
    const fxAge = Math.max(0.001, readNumber(params, 'fxAge', eventName === 'lock' ? 0.22 : 0.48));
    const comboCount = Math.max(2, Math.floor(readNumber(params, 'combo', 10)));

    const runtime = createKoiPondRuntime({
        scene, camera, renderer, params, quality, reducedMotion, intensity: 1,
    });

    // Water sets ACES on the renderer; the post chain owns AgX in-graph, so the
    // renderer must not double tone-map. renderOutput applies NoToneMapping + sRGB.
    renderer.toneMapping = THREE.NoToneMapping;

    const profile = getKoiPondPostProfile(quality);
    // Allow quick URL overrides while iterating.
    ['bloomStrength', 'bloomThreshold', 'bloomRadius', 'exposure', 'contrast', 'saturation',
        'splitStrength', 'vignetteDarkness'].forEach((key) => {
        if (params?.has?.(key)) profile[key] = readNumber(params, key, profile[key]);
    });

    let post = null;
    if (postEnabled && profile.enabled) {
        post = new KoiPondPost(renderer, scene, camera, profile);
        const width = Math.max(1, sizes?.width || 1280);
        const height = Math.max(1, sizes?.height || 720);
        post.setSize(width, height);
        if (typeof window !== 'undefined') window.__KOI_POST__ = post;
    }

    let seeded = false;
    let cameraConfigured = false;

    function seed(time) {
        const birthTime = Math.max(0.0001, time - fxAge);
        runtime.update(birthTime, 0);
        if (eventName === 'lock' || eventName === 'combo') {
            runtime.pulse('PIECE_LOCK', { piece: makePiece(params), player: 0 });
            if (eventName === 'combo') runtime.pulse('COMBO', { comboCount, player: 0 });
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
            post?.update({ time });
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        resize(width, height) {
            cameraConfigured = false;
            runtime.resize(width, height);
            post?.setSize(width, height);
        },
        getDiagnostics: runtime.getDiagnostics,
        getRendererCounters: runtime.getRendererCounters,
        dispose() {
            if (typeof window !== 'undefined' && window.__KOI_POST__ === post) delete window.__KOI_POST__;
            post?.dispose();
            runtime.dispose();
        },
    };
}
