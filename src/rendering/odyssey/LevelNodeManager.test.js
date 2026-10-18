import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    LevelNodeManager,
    ODYSSEY_NODE_SHELL_STYLE_INDEX,
    resolveOdysseyNodeShellStyle,
} from './LevelNodeManager.js';
import { ODYSSEY_NODE_STYLES } from './chapter-environments/shared/chapter-profile.js';

describe('Odyssey node shell styles', () => {
    it('maps each P3b world shell to a stable shader index', () => {
        expect(ODYSSEY_NODE_SHELL_STYLE_INDEX).toEqual({
            [ODYSSEY_NODE_STYLES.MAGMA_GEODE]: 0,
            [ODYSSEY_NODE_STYLES.BUBBLE_PEARL]: 1,
            [ODYSSEY_NODE_STYLES.SEED_LANTERN]: 2,
            [ODYSSEY_NODE_STYLES.CAIRN_LANTERN]: 3,
            [ODYSSEY_NODE_STYLES.CLOUD_WISP]: 4,
            [ODYSSEY_NODE_STYLES.STARLIT_ORB]: 5,
            [ODYSSEY_NODE_STYLES.LENSED_SHARD]: 6,
            [ODYSSEY_NODE_STYLES.NEON_SIGN]: 7,
        });
    });

    it('resolves the eight chapter profiles to distinct shell styles', () => {
        const chapterShells = Array.from({ length: 8 }, (_, index) => (
            resolveOdysseyNodeShellStyle(index + 1, index + 1)
        ));

        expect(chapterShells.map((shell) => shell.style)).toEqual([
            ODYSSEY_NODE_STYLES.MAGMA_GEODE,
            ODYSSEY_NODE_STYLES.BUBBLE_PEARL,
            ODYSSEY_NODE_STYLES.SEED_LANTERN,
            ODYSSEY_NODE_STYLES.CAIRN_LANTERN,
            ODYSSEY_NODE_STYLES.CLOUD_WISP,
            ODYSSEY_NODE_STYLES.STARLIT_ORB,
            ODYSSEY_NODE_STYLES.LENSED_SHARD,
            ODYSSEY_NODE_STYLES.NEON_SIGN,
        ]);
        expect(chapterShells.map((shell) => shell.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('falls back to chapter 1 styling for unknown chapters', () => {
        expect(resolveOdysseyNodeShellStyle(99, 12)).toMatchObject({
            style: ODYSSEY_NODE_STYLES.MAGMA_GEODE,
            index: 0,
            baseColor: 0xff4400,
            accentColor: 0xffaa44,
        });
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
