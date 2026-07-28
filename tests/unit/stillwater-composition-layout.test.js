import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { createStillwaterForest } from '../../src/themes/stillwater/rendering/stillwater-forest.js';
import { resolveStillwaterLayout } from '../../src/themes/stillwater/composition/stillwater-layout.js';

/**
 * Composition guards. The board is the product; the scene frames it and must
 * never crowd it. These assertions exist because the framing trunks added in
 * Wave 2 sit close to the camera, which is exactly where an accidental
 * intrusion into the play field would be most damaging and least obvious in a
 * wide screenshot.
 */
function makeForest(quality = 'High') {
    const scene = new THREE.Scene();
    const layout = resolveStillwaterLayout({ aspect: 16 / 9 });
    const camera = new THREE.PerspectiveCamera(
        layout.camera.fov,
        16 / 9,
        layout.camera.near,
        layout.camera.far,
    );
    camera.position.set(...layout.camera.position);
    camera.lookAt(...layout.camera.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const runtime = createStillwaterForest({
        scene, camera, quality,
    });
    return {
        scene, camera, runtime, layout,
    };
}

describe('Stillwater composition layout', () => {
    it('keeps the board aperture clear of focal geometry at every tier', () => {
        for (const quality of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            const { runtime } = makeForest(quality);
            const diagnostics = runtime.getDiagnostics();
            expect(diagnostics.focalIntrusions, `${quality} focal intrusions`).toBe(0);
            expect(diagnostics.boardSafe, `${quality} board safe`).toBe(true);
            runtime.dispose();
        }
    });

    it('never drops the two framing trunks, even on the leanest tier', () => {
        // They are composition, not detail: a cropped trunk is what tells the
        // viewer the forest continues past the frame.
        for (const quality of ['Minimal', 'Low', 'High', 'Extreme']) {
            const { runtime } = makeForest(quality);
            expect(
                runtime.getDiagnostics().counts.heroTrees,
                `${quality} hero trees`,
            ).toBeGreaterThanOrEqual(2);
            runtime.dispose();
        }
    });

    it('reserves the centre of frame: no discrete prop projects into the board rect', () => {
        const { scene, camera, layout } = makeForest('Extreme');
        const [board] = layout.boardSafeRegions;
        const projected = new THREE.Vector3();
        const size = new THREE.Vector3();
        const box = new THREE.Box3();
        const intruders = [];

        scene.updateMatrixWorld(true);
        scene.traverse((object) => {
            if (!object.isMesh || object.isInstancedMesh || !object.geometry) return;
            box.setFromObject(object);
            if (box.isEmpty()) return;
            box.getSize(size);
            // Spanning surfaces — terrain, the lake plane, the ridge — are the
            // ground and the horizon. Their bounding-box centre necessarily
            // lands mid-frame because they span the whole scene, so a centre
            // test says nothing about them. Only DISCRETE props can occlude the
            // board, and the widest of those (a boulder) is well under 60u
            // against a 250-850u backdrop.
            if (size.x > 60) return;
            box.getCenter(projected);
            projected.project(camera);
            const screenX = projected.x * 0.5 + 0.5;
            const screenY = 0.5 - projected.y * 0.5;
            const insideX = screenX > board.x && screenX < board.x + board.width;
            const insideY = screenY > board.y && screenY < board.y + board.height;
            // Only geometry in FRONT of the camera can occlude the board.
            if (insideX && insideY && projected.z < 1) intruders.push(object.name || object.type);
        });

        expect(intruders).toEqual([]);
    });

    it('pins the solo camera the composition was authored against', () => {
        const layout = resolveStillwaterLayout({ aspect: 16 / 9 });
        // Every tuned constant in the forest, bank and repoussoir layout is
        // relative to this framing. Changing it invalidates all of them.
        expect(layout.camera.position).toEqual([0, 14.5, 39]);
        expect(layout.camera.target).toEqual([0, 3.8, -15]);
        expect(layout.camera.fov).toBe(46);
    });
});
