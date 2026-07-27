/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Koi Pond v2 — gameplay reaction study.
 *
 * This playground slice layers the production-ready Moonwake Procession pools
 * over the verified black-jade water study. It exercises the real renderer-
 * neutral gameplay router, including exact rotated tetromino glyphs.
 *
 * Phase-locked examples:
 *   ?effect=koi-pond-reactions&event=lock&piece=T&fxAge=0.22&t=12&orbit=0
 *   ?effect=koi-pond-reactions&event=combo&combo=7&fxAge=0.48&t=12&orbit=0
 *   ?effect=koi-pond-reactions&event=combo&combo=10&quality=Low&fxAge=0.48&t=12&orbit=0
 *   ?effect=koi-pond-reactions&event=combo&combo=10&reducedMotion=1&fxAge=0.14&t=12&orbit=0
 */
import * as THREE from 'three/webgpu';

import {
    KoiPondGameplayRouting,
} from '../../themes/koi-pond/koi-pond-gameplay-routing.js';
import {
    createKoiPondGameplayFX,
} from '../../themes/koi-pond/rendering/koi-pond-gameplay-fx.js';
import { create as createWaterStudy } from './koi-pond-water.effect.js';

export const meta = {
    id: 'koi-pond-reactions',
    title: 'Koi Pond v2 — Moonwake Reactions',
    description: 'Four-cell jade lock seals and milestone-driven koi processions on black-jade water.',
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

const VALID_EVENTS = new Set(['idle', 'lock', 'combo']);
const VALID_PIECES = new Set(Object.keys(SHAPES));

function readNumber(params, key, fallback) {
    const raw = params?.get(key);
    if (raw == null || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function readBoolean(params, ...keys) {
    return keys.some((key) => {
        const value = params?.get(key);
        if (value == null) return false;
        const normalized = String(value).trim().toLowerCase();
        return normalized === '' || normalized === '1'
            || normalized === 'true' || normalized === 'yes';
    });
}

function normalizeQuality(value) {
    const normalized = String(value || 'High').trim().toLowerCase();
    const qualities = {
        minimal: 'Minimal',
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        ultra: 'Ultra',
        extreme: 'Extreme',
    };
    return qualities[normalized] || 'High';
}

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function rotateShape(shape) {
    const height = shape.length;
    const width = shape.reduce((largest, row) => Math.max(largest, row.length), 0);
    const rotated = Array.from({ length: width }, () => Array(height).fill(0));
    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            rotated[column][height - row - 1] = shape[row]?.[column] || 0;
        }
    }
    return rotated;
}

function rotatedShape(type, rotation) {
    let shape = cloneShape(SHAPES[type] || SHAPES.T);
    const turns = ((Math.floor(rotation) % 4) + 4) % 4;
    for (let turn = 0; turn < turns; turn += 1) shape = rotateShape(shape);
    return shape;
}

function mapSideLaneToWater(origin) {
    const sideLane = origin?.sideLane;
    const side = sideLane?.side === 'left' ? -1 : 1;
    const normalizedY = Math.max(0, Math.min(1, Number(sideLane?.normalized?.y) || 0.5));
    return {
        x: side * 10.9,
        y: 0.30,
        z: -16.1 + normalizedY * 21.2,
    };
}

function createBoardGuide(scene) {
    const group = new THREE.Group();
    group.name = 'koi-pond-board-sanctuary-guide';

    const material = new THREE.MeshBasicNodeMaterial({
        color: 0x8ae0ba,
        transparent: true,
        opacity: 0.22,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
    });
    const longGeometry = new THREE.BoxGeometry(0.07, 0.035, 13.2);
    const shortGeometry = new THREE.BoxGeometry(7.3, 0.035, 0.07);
    const rails = [
        new THREE.Mesh(longGeometry, material),
        new THREE.Mesh(longGeometry, material),
        new THREE.Mesh(shortGeometry, material),
        new THREE.Mesh(shortGeometry, material),
    ];
    rails[0].position.set(-3.65, 0.34, -5.5);
    rails[1].position.set(3.65, 0.34, -5.5);
    rails[2].position.set(0, 0.34, -12.1);
    rails[3].position.set(0, 0.34, 1.1);
    rails.forEach((rail) => {
        rail.renderOrder = 34;
        group.add(rail);
    });
    scene.add(group);

    return {
        dispose() {
            scene.remove(group);
            group.clear();
            longGeometry.dispose();
            shortGeometry.dispose();
            material.dispose();
        },
    };
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

export function create({
    scene, camera, renderer, params, quality: requestedQuality,
}) {
    const eventCandidate = String(params?.get('event') || 'lock').trim().toLowerCase();
    const event = VALID_EVENTS.has(eventCandidate) ? eventCandidate : 'lock';
    const pieceCandidate = String(params?.get('piece') || 'T').trim().toUpperCase();
    const pieceType = VALID_PIECES.has(pieceCandidate) ? pieceCandidate : 'T';
    const rotation = Math.floor(readNumber(params, 'rotation', 0));
    const col = readNumber(params, 'col', 4);
    const row = readNumber(params, 'row', 17);
    const comboCount = Math.max(2, Math.floor(readNumber(params, 'combo', 7)));
    const defaultAge = event === 'lock' ? 0.22 : 0.48;
    const fxAge = Math.max(0.001, readNumber(params, 'fxAge', defaultAge));
    const quality = normalizeQuality(params?.get('quality') || requestedQuality);
    const reducedMotion = readBoolean(params, 'reducedMotion', 'reduced');
    const fixedTime = params?.has('t');
    const showBoardGuide = readBoolean(params, 'boardGuide', 'board');

    const water = createWaterStudy({
        scene,
        camera,
        renderer,
        params,
        quality,
    });
    const boardGuide = showBoardGuide ? createBoardGuide(scene) : null;

    let routerClockMs = 0;
    const routing = new KoiPondGameplayRouting({
        clock: () => routerClockMs,
        reducedMotion,
    });
    const fx = createKoiPondGameplayFX({
        scene,
        isWebGPU: renderer?.backend?.isWebGPUBackend === true,
        quality,
        reducedMotion,
        pondCenter: { x: 0, y: 0.30, z: -6 },
        pondRadii: { x: 14.4, z: 7.8 },
    });

    let seeded = false;
    let commandSnapshot = null;

    function makePiece() {
        return {
            type: pieceType,
            shape: rotatedShape(pieceType, rotation),
            rotation,
            x: col,
            y: row,
            pieceId: `playground-${pieceType}-${rotation}`,
        };
    }

    function enqueueCommands(commands, birthTime) {
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            command.worldOrigin = mapSideLaneToWater(command.origin);
            command.birthTime = birthTime;
            fx.enqueue(command);
            commandSnapshot = {
                type: command.type,
                glyph: command.glyph?.type || null,
                comboCount: command.comboCount || 0,
                milestone: command.milestone || null,
                tier: command.tier || 0,
                worldOrigin: { ...command.worldOrigin },
            };
        }
    }

    function seed(atTime) {
        const birthTime = Math.max(0.0001, atTime - fxAge);
        routerClockMs = birthTime * 1000;

        // Compile all three tiny node pipelines before the authored event frame.
        fx.update(0);
        fx.update(birthTime);

        if (event === 'lock') {
            routing.dispatch('PIECE_LOCK', { piece: makePiece(), player: 0 });
            enqueueCommands(routing.drainCommands(), birthTime);
        } else if (event === 'combo') {
            // Establish the real per-player lock origin, but keep this visual slice
            // focused on the combo by discarding the setup lock command.
            routing.dispatch('PIECE_LOCK', { piece: makePiece(), player: 0 });
            routing.drainCommands();
            routing.dispatch('COMBO', { comboCount, player: 0 });
            enqueueCommands(routing.drainCommands(), birthTime);
        }
        fx.update(birthTime);
        seeded = true;
    }

    const diagnosticsApi = Object.freeze({
        getDiagnostics() {
            return {
                event,
                pieceType,
                rotation,
                col,
                row,
                comboCount,
                fxAge,
                quality,
                reducedMotion,
                boardGuide: showBoardGuide,
                command: commandSnapshot,
                water: water.getDiagnostics?.() || null,
                routing: routing.getState(),
                fx: fx.getDebugState(),
            };
        },
    });
    window.__KOI_POND_REACTIONS__ = diagnosticsApi;

    return {
        cameraRadius: 34,
        camera(time, activeCamera) {
            water.camera?.(time, activeCamera);
        },
        update(time) {
            if (!seeded) seed(fixedTime ? time : Math.max(time, fxAge));
            const effectTime = fixedTime ? time : Math.max(time, fxAge);
            water.update?.(time);
            fx.update(effectTime);
        },
        resize(width, height) {
            water.resize?.(width, height);
        },
        getCaptureMeta() {
            return {
                event,
                recommendedFxAges: event === 'lock'
                    ? [0.06, 0.22, 0.44]
                    : [0.20, 0.48, 0.82],
                comboMilestones: [2, 4, 7, 10],
                boardSanctuary: {
                    center: { x: 0, z: -5.5 },
                    width: 7.3,
                    depth: 13.2,
                },
                maxIncrementalDraws: 3,
            };
        },
        getDiagnostics: diagnosticsApi.getDiagnostics,
        getRendererCounters() {
            const fxState = fx.getDebugState();
            return {
                ...rendererCounters(renderer),
                effectActiveDraws: fxState.activeDraws,
                effectActiveParticles: fxState.activeInstances,
                effectSubmittedInstances: fxState.submittedInstances,
            };
        },
        getActiveParticleCount() {
            return fx.getActiveParticleCount();
        },
        dispose() {
            if (window.__KOI_POND_REACTIONS__ === diagnosticsApi) {
                delete window.__KOI_POND_REACTIONS__;
            }
            routing.dispose();
            fx.dispose();
            boardGuide?.dispose();
            water.dispose?.();
        },
    };
}
