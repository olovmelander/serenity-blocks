import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
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

describe('Odyssey orb bob', () => {
    it('moves the drawn orbs every frame, not only when the buffers are dirty', () => {
        // Audit 2026-10-23: written only on dirty frames, the bob stepped at ~10 Hz during a
        // drift and froze while the camera was parked.
        const glass = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 4, 3), new THREE.MeshBasicMaterial(), 2);
        const attr = () => new THREE.BufferAttribute(new Float32Array(8), 4);
        const windowAttr = attr();
        const haloAttr = attr();
        const node = (id, visible) => ({
            config: { id },
            group: {
                visible, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1),
            },
        });
        const manager = {
            time: 0,
            nodes: new Map([[1, node(1, true)], [2, node(2, false)]]),
            instanceIdMap: new Map([[1, 0], [2, 1]]),
            cachedBasePositions: new Map([[1, new THREE.Vector3(10, 20, 30)], [2, new THREE.Vector3(0, 0, 0)]]),
            glassInstancedMesh: glass,
            windowMesh: { geometry: { getAttribute: () => windowAttr } },
            haloMesh: { geometry: { getAttribute: () => haloAttr } },
            _scratchMatrix: new THREE.Matrix4(),
            _applyBob: LevelNodeManager.prototype._applyBob,
            _setGlassCentre: LevelNodeManager.prototype._setGlassCentre,
            _flagGlassCentres: LevelNodeManager.prototype._flagGlassCentres,
        };
        // The shells' centres ride with them (ROUND ON SCREEN, odyssey-orb-round.tsl.js).
        glass.geometry.setAttribute('aCentre', new THREE.InstancedBufferAttribute(new Float32Array(6), 3));
        const bob = () => LevelNodeManager.prototype._bobDrawnNodes.call(manager);
        manager.time = 1;
        bob();
        const first = manager.nodes.get(1).group.position.clone();
        manager.time = 1.5;
        bob();
        const second = manager.nodes.get(1).group.position.clone();
        expect(second.distanceTo(first)).toBeGreaterThan(0.01);
        expect(second.distanceTo(new THREE.Vector3(10, 20, 30))).toBeLessThan(0.25);
        const m = new THREE.Matrix4();
        glass.getMatrixAt(0, m);
        // (Float32 buffers.)
        expect(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(second)).toBeLessThan(1e-5);
        expect(windowAttr.getX(0)).toBeCloseTo(second.x, 4);
        expect(haloAttr.getY(0)).toBeCloseTo(second.y, 4);
        expect(glass.geometry.getAttribute('aCentre').getZ(0)).toBeCloseTo(second.z, 4);
        // A hidden orb is left where the dirty pass parked it.
        expect(manager.nodes.get(2).group.position.length()).toBe(0);
    });
});

describe('Odyssey orb entry pulse', () => {
    afterEach(() => vi.restoreAllMocks());

    it('swells the chosen orb once, up quickly and down slowly, and lets it go', () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const manager = {
            nodes: new Map([[7, {}]]),
            _markUploadDirty: vi.fn(),
        };
        LevelNodeManager.prototype.pulseNode.call(manager, 7, 600);
        const scale = (id) => LevelNodeManager.prototype._pulseScale.call(manager, id);
        expect(scale(7)).toBeCloseTo(1, 6);
        now += 180; // 30 %: the peak
        expect(scale(7)).toBeCloseTo(1.16, 6);
        expect(scale(8)).toBe(1);
        now += 210;
        expect(scale(7)).toBeGreaterThan(1);
        expect(scale(7)).toBeLessThan(1.16);
        now += 300;
        expect(scale(7)).toBeCloseTo(1, 6);
        expect(manager._markUploadDirty).toHaveBeenCalled();
    });

    it('wakes an orb ahead of the ride more gently than an orb being entered', () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const manager = { nodes: new Map([[9, {}]]), _markUploadDirty: vi.fn() };
        LevelNodeManager.prototype.pulseNode.call(manager, 9, 1000, 0.12);
        now = 300;
        expect(LevelNodeManager.prototype._pulseScale.call(manager, 9)).toBeCloseTo(1.12, 6);
    });
});

describe('Odyssey stars landing on a finished orb', () => {
    afterEach(() => vi.restoreAllMocks());

    /** A manager with one completed orb in view of a camera at +z, as the billboard pass needs it. */
    function landingManager() {
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
        camera.position.set(0, 0, 20);
        camera.lookAt(0, 0, 0);
        const stars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 3);
        stars.geometry.setAttribute('aStar', new THREE.InstancedBufferAttribute(new Float32Array(3), 1));
        const manager = {
            camera,
            starInstancedMesh: stars,
            nodes: new Map([[5, {
                config: { id: 5 },
                group: {
                    visible: true,
                    position: new THREE.Vector3(),
                    scale: new THREE.Vector3(1, 1, 1),
                    userData: { completed: true, stars: 3 },
                },
            }]]),
            instanceIdMap: new Map([[5, 0]]),
            _starSlotState: new Uint8Array(3),
            _lastIndicatorCamMatrix: new THREE.Matrix4(),
            _scratchMatrix: new THREE.Matrix4(),
            _scratchScaleVec: new THREE.Vector3(),
            _scratchCamRight: new THREE.Vector3(),
            _scratchCamUp: new THREE.Vector3(),
            _scratchCamPos: new THREE.Vector3(),
            _scratchToCam: new THREE.Vector3(),
            _scratchIndicatorPos: new THREE.Vector3(),
            _markerMeshPairs: [],
            _markUploadDirty: vi.fn(),
        };
        const place = () => LevelNodeManager.prototype._updateIndicatorBillboards.call(manager, true);
        const star = (slot) => {
            const matrix = new THREE.Matrix4();
            stars.getMatrixAt(slot, matrix);
            // (Read from the columns: decompose() gives a zero-scale matrix a scale of 1.)
            return {
                y: new THREE.Vector3().setFromMatrixPosition(matrix).y,
                scale: new THREE.Vector3().setFromMatrixColumn(matrix, 0).length(),
            };
        };
        return { manager, place, star };
    }

    it('drops each star onto its seat, one after the other, and leaves them exactly where they rest', () => {
        let now = 5000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const { manager, place, star } = landingManager();
        place();
        const rest = [0, 1, 2].map(star);
        expect(rest[0].scale).toBeGreaterThan(0);

        LevelNodeManager.prototype.landStars.call(manager, 5);
        expect(manager._markUploadDirty).toHaveBeenCalled();
        now += 60;
        place();
        // The first is on its way down, above its seat; the others have not appeared yet.
        expect(star(0).y).toBeGreaterThan(rest[0].y + 0.3);
        expect(star(0).scale).toBeGreaterThan(0);
        expect(star(1).scale).toBe(0);
        expect(star(2).scale).toBe(0);
        now += 400;
        place();
        // The first is down and swelling as it lands; the last is still falling.
        expect(star(0).scale).toBeGreaterThan(rest[0].scale);
        expect(star(2).y).toBeGreaterThan(rest[2].y);
        now += 2000;
        place();
        [0, 1, 2].forEach((slot) => {
            expect(star(slot).y).toBeCloseTo(rest[slot].y, 5);
            expect(star(slot).scale).toBeCloseTo(rest[slot].scale, 5);
        });
    });

    it('lands nothing on an orb it does not have, and only on the orb asked for', () => {
        const { manager } = landingManager();
        LevelNodeManager.prototype.landStars.call(manager, 99);
        expect(manager._starLanding).toBeUndefined();
        expect(manager._markUploadDirty).not.toHaveBeenCalled();
    });
});
