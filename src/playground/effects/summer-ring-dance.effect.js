/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Summer "Midsummer Promise" — isolated Seven-Flower Ring Dance (plan Wave 2).
 *
 * A board-safe frame plus small meadow/maypole proxy and the production wreath +
 * halo pools from summer-gameplay-fx.js, driven through the real routing so the
 * combo milestone ladder is exercised. The wreath encircles the board frame with
 * its centre kept clear (§5.2, §6); combo 10+ opens the midnight-sun halo.
 *
 * URL examples:
 *   playground.html?effect=summer-ring-dance&t=8&combo=7&fxAge=0.55&orbit=0
 *   playground.html?effect=summer-ring-dance&combo=2&fxAge=0.4&orbit=0
 *   playground.html?effect=summer-ring-dance&combo=10&fxAge=0.7&orbit=0
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, max, mix, smoothstep, uv, vec3, vec4,
} from 'three/tsl';

import { createSummerGameplayFX } from '../../themes/summer/rendering/summer-gameplay-fx.js';
import { SummerGameplayRouting } from '../../themes/summer/composition/summer-gameplay-routing.js';

export const meta = {
    id: 'summer-ring-dance',
    title: 'Summer — Ring Dance',
    description: 'Isolated seven-flower wreath combo ladder around a board frame.',
};

const BOARD_CENTER = Object.freeze({ x: 0, y: 0.1, z: 0 });
const LOCK_ORIGIN = Object.freeze({ x: 0, y: -1.2, z: 0.05 });

function readNumber(params, key, fallback) {
    const raw = Number(params?.get(key));
    return Number.isFinite(raw) ? raw : fallback;
}

function readBoolean(params, ...keys) {
    return keys.some((key) => {
        const value = params?.get(key);
        if (value == null) return false;
        const normalized = String(value).trim().toLowerCase();
        return normalized === '' || normalized === '1' || normalized === 'true' || normalized === 'yes';
    });
}

function normalizeQuality(value) {
    const normalized = String(value || 'High').trim().toLowerCase();
    const table = {
        minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', extreme: 'Extreme',
    };
    return table[normalized] || 'High';
}

function buildProxy(scene) {
    const disposables = [];
    const skyGeo = new THREE.SphereGeometry(60, 24, 16);
    const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    skyMat.colorNode = Fn(() => mix(vec3(0.86, 0.90, 0.83), vec3(0.52, 0.72, 0.82), uv().y.mul(1.1).clamp(0, 1)))();
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
    disposables.push(skyGeo, skyMat);

    const groundGeo = new THREE.PlaneGeometry(120, 120, 1, 1);
    const groundMat = new THREE.MeshBasicNodeMaterial();
    groundMat.colorNode = Fn(() => {
        const shore = smoothstep(0.5, 0.75, uv().y);
        return vec4(mix(vec3(0.30, 0.42, 0.20), vec3(0.5, 0.6, 0.42), shore), 1.0);
    })();
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.6;
    scene.add(ground);
    disposables.push(groundGeo, groundMat);

    // Board-safe frame: a faint dark playfield rectangle so the wreath can be
    // judged for keeping the centre clear.
    const boardGeo = new THREE.PlaneGeometry(1.7, 3.4);
    const boardMat = new THREE.MeshBasicNodeMaterial({ transparent: true });
    boardMat.colorNode = Fn(() => {
        const p = uv().sub(0.5);
        const border = max(abs(p.x).mul(2.0), abs(p.y).mul(2.0));
        const edge = smoothstep(0.9, 0.98, border);
        const fill = smoothstep(0.98, 0.9, border).mul(0.10);
        return vec4(vec3(0.05, 0.08, 0.06), edge.mul(0.5).add(fill));
    })();
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(BOARD_CENTER.x, BOARD_CENTER.y, -0.1);
    scene.add(board);
    disposables.push(boardGeo, boardMat);

    return {
        dispose() {
            [sky, ground, board].forEach((o) => scene.remove(o));
            disposables.forEach((d) => d.dispose?.());
        },
    };
}

export function create({
    scene, camera, renderer, params,
}) {
    const proxy = buildProxy(scene);
    const combo = Math.max(2, Math.round(readNumber(params, 'combo', 7)));
    const fxAge = Math.max(0.001, readNumber(params, 'fxAge', 0.55));
    const quality = normalizeQuality(params?.get('quality'));
    const reducedMotion = readBoolean(params, 'reducedMotion', 'reduced');
    const fixedTime = params?.has('t');

    const controller = new SummerGameplayRouting({ clock: () => 0, reducedMotion });
    const fx = createSummerGameplayFX({
        scene,
        camera,
        isWebGPU: renderer?.backend?.isWebGPUBackend === true,
        quality,
        reducedMotion,
    });

    let seeded = false;
    function seed(atTime) {
        const spawn = Math.max(0.0001, atTime - fxAge);
        fx.update(0);
        fx.update(spawn);
        controller.dispatch('PIECE_LOCK', { piece: { type: 'T', x: 4, y: 17 } });
        controller.dispatch('COMBO', { comboCount: combo });
        const commands = controller.drainCommands();
        for (let i = 0; i < commands.length; i += 1) {
            const command = commands[i];
            command.worldOrigin = command.type === 'wreath' ? BOARD_CENTER : LOCK_ORIGIN;
            fx.enqueue(command);
        }
        fx.update(spawn);
        seeded = true;
    }

    return {
        cameraRadius: 8,
        camera(time, activeCamera) {
            activeCamera.position.set(0, 0.1, 8.2);
            activeCamera.lookAt(0, 0.1, 0);
        },
        update(time) {
            if (!seeded) seed(fixedTime ? time : fxAge);
            fx.update(fixedTime ? time : Math.max(time, fxAge));
        },
        resize() {},
        getDiagnostics() {
            return {
                combo, fxAge, quality, reducedMotion, fx: fx.getDebugState(),
            };
        },
        dispose() {
            controller.dispose();
            fx.dispose();
            proxy.dispose();
        },
    };
}
