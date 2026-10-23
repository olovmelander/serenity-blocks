import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { LevelNodeManager } from './LevelNodeManager.js';
import {
    ORB_STAR_SIZE,
    ORB_STAR_SLOTS,
    ORB_WINDOW_DEPTH,
    ORB_WINDOW_SHARE,
} from './level-node-manager.tsl.js';

describe('Odyssey orb design (a world in a glass marble)', () => {
    const TSL_SOURCE = readFileSync(fileURLToPath(new URL('./level-node-manager.tsl.js', import.meta.url)), 'utf8');

    it('rounds the atlas layer it samples, never truncates it', () => {
        // The layer arrives interpolated as 4.9999 on some pixels; toInt() truncating it drew
        // those pixels from the neighbouring icon (two worlds speckled together in one orb).
        const samples = TSL_SOURCE.match(/\.depth\([^;]*/g) || [];
        expect(samples.length).toBeGreaterThan(0);
        samples.forEach((call) => expect(call).toMatch(/\.add\(0\.5\)\.toInt\(\)/));
    });

    it('keeps the world window inside the glass', () => {
        expect(Math.hypot(ORB_WINDOW_SHARE, ORB_WINDOW_DEPTH)).toBeLessThan(1);
    });

    it('arcs the three stars over the crown without overlapping', () => {
        for (let i = 1; i < ORB_STAR_SLOTS.length; i += 1) {
            const a = ORB_STAR_SLOTS[i - 1];
            const b = ORB_STAR_SLOTS[i];
            expect(Math.hypot(a.right - b.right, a.up - b.up)).toBeGreaterThan(ORB_STAR_SIZE);
        }
        ORB_STAR_SLOTS.forEach((slot) => expect(Math.hypot(slot.right, slot.up)).toBeGreaterThan(1));
    });
});

describe('Odyssey orb near-lens fade', () => {
    const node = (id, x, z) => ({ config: { id }, group: { visible: true, position: new THREE.Vector3(x, 0, z) } });
    const manager = (cam, nodes, extra = {}) => ({
        camera: { position: cam },
        nodes: new Map(nodes.map((n) => [n.config.id, n])),
        cachedBasePositions: new Map(),
        _lastUploadCamPos: new THREE.Vector3(0, 0, 0),
        _nearFadeLive: false,
        focusedLevelId: null,
        ...extra,
    });
    const stale = (m) => LevelNodeManager.prototype._nearFadeStale.call(m);

    it('re-scales when the camera moves near an orb without path progress changing', () => {
        // L57: the camera flew through the orb on its way to the focus, then parked.
        expect(stale(manager(new THREE.Vector3(0, 0, 0), [node(57, 0, -8)]))).toBe(false);
        expect(stale(manager(new THREE.Vector3(0, 0, -1), [node(57, 0, -8)]))).toBe(true);
        expect(stale(manager(new THREE.Vector3(0, 0, -1), [node(57, 0, -80)]))).toBe(false);
        const wasNear = manager(new THREE.Vector3(0, 0, -1), [node(57, 0, -80)], { _nearFadeLive: true });
        expect(stale(wasNear)).toBe(true);
    });

    it('leaves the focused orb out: focus parks inside the fade band by design', () => {
        expect(stale(manager(new THREE.Vector3(0, 0, -1), [node(57, 0, -8)], { focusedLevelId: 57 }))).toBe(false);
    });
});

describe('Odyssey rival and boss markers', () => {
    const camRight = new THREE.Vector3(1, 0, 0);
    const camUp = new THREE.Vector3(0, 1, 0);
    const side = (tangent, state) => LevelNodeManager.prototype._markerScreenSide.call(
        {},
        { pathPosition: 0.5, group: { userData: { markerTangent: tangent.clone().normalize(), markerSideState: state } } },
        camRight,
        camUp,
    );

    it('hangs under the orb when the path crosses the frame', () => {
        const s = side(new THREE.Vector3(1, 0, 0));
        expect(s.x).toBeCloseTo(0, 6);
        expect(s.y).toBeCloseTo(-1, 6);
    });

    it('moves beside the orb when the path runs down the frame, off the ribbon', () => {
        const s = side(new THREE.Vector3(0, 1, 0));
        expect(Math.abs(s.x)).toBeCloseTo(1, 6);
        expect(s.y).toBeCloseTo(0, 6);
    });

    it('keeps its side through a small sway instead of flicking across the ribbon', () => {
        const state = { sign: 1, x: 0, y: -1 };
        const first = { ...side(new THREE.Vector3(0.05, 1, 0), state) };
        const swayed = side(new THREE.Vector3(-0.05, 1, 0), state);
        expect(Math.sign(swayed.x)).toBe(Math.sign(first.x));
    });
});

describe('Odyssey orb picking', () => {
    it('finds an orb that moved in after the first raycast (the cached bounding sphere)', () => {
        const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial(), 2);
        const parked = new THREE.Matrix4().makeTranslation(0, -99999, 0);
        // Orb A is shown near the start; orb B waits parked below the map.
        mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, -10));
        mesh.setMatrixAt(1, parked);
        mesh.updateMatrixWorld(true);
        const manager = {
            glassInstancedMesh: mesh,
            nodeIds: [1, 40],
            nodes: new Map([[1, {}], [40, {}]]),
        };
        const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
        expect(LevelNodeManager.prototype.raycast.call(manager, raycaster)).toBe(1);

        // The camera travels on and up (the path climbs into the sky and space): orb A is
        // parked, orb B is shown high along the path and the camera looks up at it. The
        // sphere cached at the first ray hangs far below and this ray never comes down to it.
        mesh.setMatrixAt(0, parked);
        const b = new THREE.Vector3(520, 3010, -520);
        mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z));
        const eye = new THREE.Vector3(500, 3000, -500);
        raycaster.set(eye, b.clone().sub(eye).normalize());
        expect(LevelNodeManager.prototype.raycast.call(manager, raycaster)).toBe(40);
    });
});
