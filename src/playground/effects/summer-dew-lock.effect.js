/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Summer "Midsummer Promise" — isolated Dew-Pressed Lock Seal (plan Wave 1).
 *
 * A tiny sunlit meadow/shore proxy plus the production dew pool from
 * summer-gameplay-fx.js, driven through the real routing controller so exact
 * rotated-glyph extraction is exercised. Deterministic: the seal is spawned so
 * that at scene time `t` its age equals `fxAge`, giving phase-locked captures.
 *
 * URL examples:
 *   playground.html?effect=summer-dew-lock&t=8&piece=T&col=4&row=17&fxAge=0.22&orbit=0
 *   playground.html?effect=summer-dew-lock&piece=I&fxAge=0.06&orbit=0
 *   playground.html?effect=summer-dew-lock&piece=O&fxAge=0.5&reducedMotion=1&orbit=0
 */
import * as THREE from 'three/webgpu';
import {
    Fn, mix, smoothstep, uv, vec3, vec4,
} from 'three/tsl';

import { createSummerGameplayFX } from '../../themes/summer/rendering/summer-gameplay-fx.js';
import { SummerGameplayRouting } from '../../themes/summer/composition/summer-gameplay-routing.js';

export const meta = {
    id: 'summer-dew-lock',
    title: 'Summer — Dew Lock Seal',
    description: 'Isolated four-cell dewprint at a locked-piece silhouette.',
};

const SEAL_ORIGIN = Object.freeze({ x: 0, y: 0.9, z: 0 });

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
    // Sky dome: warm horizon → soft summer blue.
    const skyGeo = new THREE.SphereGeometry(60, 24, 16);
    const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    skyMat.colorNode = Fn(() => mix(vec3(0.86, 0.90, 0.83), vec3(0.52, 0.72, 0.82), uv().y.mul(1.1).clamp(0, 1)))();
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
    disposables.push(skyGeo, skyMat);

    // Ground: dense-ish meadow green with a calmer shore band near the horizon.
    const groundGeo = new THREE.PlaneGeometry(120, 120, 1, 1);
    const groundMat = new THREE.MeshBasicNodeMaterial();
    groundMat.colorNode = Fn(() => {
        const shore = smoothstep(0.62, 0.72, uv().y);
        return vec4(mix(vec3(0.30, 0.42, 0.20), vec3(0.62, 0.70, 0.60), shore), 1.0);
    })();
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    scene.add(ground);
    disposables.push(groundGeo, groundMat);

    return {
        objects: [sky, ground],
        dispose() {
            [sky, ground].forEach((o) => scene.remove(o));
            disposables.forEach((d) => d.dispose?.());
        },
    };
}

export function create({
    scene, camera, renderer, params,
}) {
    const proxy = buildProxy(scene);
    const pieceType = String(params?.get('piece') || 'T').trim().toUpperCase();
    const col = readNumber(params, 'col', 4);
    const row = readNumber(params, 'row', 17);
    const fxAge = Math.max(0.001, readNumber(params, 'fxAge', 0.3));
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

    // Nudge the seal left/centre/right with the column so all three read.
    const origin = { ...SEAL_ORIGIN, x: SEAL_ORIGIN.x + (col - 4.5) * 0.42 };

    let seeded = false;
    function seed(atTime) {
        const spawn = Math.max(0.0001, atTime - fxAge);
        fx.update(0); // compile warmup frame
        fx.update(spawn); // advance to the spawn instant
        controller.dispatch('PIECE_LOCK', { piece: { type: pieceType, x: col, y: row } });
        const commands = controller.drainCommands();
        for (let i = 0; i < commands.length; i += 1) {
            commands[i].worldOrigin = origin;
            fx.enqueue(commands[i]);
        }
        fx.update(spawn); // flush + stamp at birth = spawn
        seeded = true;
    }

    return {
        cameraRadius: 6,
        camera(time, activeCamera) {
            activeCamera.position.set(0, 1.35, 5.4);
            activeCamera.lookAt(0, 0.75, 0);
        },
        update(time) {
            if (!seeded) seed(fixedTime ? time : fxAge);
            fx.update(fixedTime ? time : Math.max(time, fxAge));
        },
        resize() {},
        getDiagnostics() {
            return {
                pieceType, col, row, fxAge, quality, reducedMotion, fx: fx.getDebugState(),
            };
        },
        dispose() {
            controller.dispose();
            fx.dispose();
            proxy.dispose();
        },
    };
}
