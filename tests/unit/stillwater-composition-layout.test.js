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

    it('reserves the centre of frame: no prop CROWDS the board', () => {
        // This assertion used to skip `isInstancedMesh` and then drop anything
        // wider than 60u. Every discrete prop in this forest is instanced and
        // every remaining mesh is a spanning surface, so it inspected exactly
        // ZERO objects and could never fail — measured: 12 meshes, 3
        // non-instanced, 0 surviving both filters.
        //
        // It also asked the wrong question. The scene is a backdrop and the
        // board is a translucent overlay in front of it, so props legitimately
        // appear behind the play field: 105 instances project inside the rect,
        // nearly all of them distant reeds and lilies down the channel. What
        // would actually damage the product is a prop big and near enough to
        // CROWD the board — so that is what is measured, per instance, from the
        // real instance matrices.
        const { scene, camera, layout } = makeForest('Extreme');
        const [board] = layout.boardSafeRegions;
        // A flat radius threshold cannot separate these cases: a legitimate
        // treetop on the horizon subtends 0.064 and a boulder dropped into the
        // middle of the lake subtends 0.068. What distinguishes them is DEPTH —
        // background scenery sits behind the play field, an occluder sits in
        // front of it — so the allowance scales with distance. Measured worst
        // case inside the rect, per band (Extreme):
        //   dist   0-60  max 0.028   (lilies)
        //   dist  60-90  max 0.023   (lilies)
        //   dist  90-140 max 0.043   (shore roots)
        //   dist 140+    max 0.064   (far forest)
        // This line sits ~35% above each, and rejects the mid-lake boulder that
        // a flat 0.10 gate waved through.
        const maxScreenRadiusAt = (distance) => 0.02 + distance * 0.0003;
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const edge = new THREE.Vector3();
        const crowders = [];

        scene.updateMatrixWorld(true);
        scene.traverse((object) => {
            if (!object.isInstancedMesh || !object.geometry) return;
            object.geometry.computeBoundingSphere?.();
            const baseRadius = object.geometry.boundingSphere?.radius ?? 0;
            if (!baseRadius) return;
            // `.count` and not the buffer length: the quality tier decides how
            // many instances actually draw.
            for (let index = 0; index < object.count; index += 1) {
                object.getMatrixAt(index, matrix);
                matrix.premultiply(object.matrixWorld);
                matrix.decompose(position, rotation, scale);
                edge.copy(position).setX(position.x + baseRadius * Math.max(scale.x, scale.y, scale.z));
                const centre = position.clone().project(camera);
                // Only geometry in FRONT of the camera can crowd anything.
                if (centre.z >= 1) continue;
                const screenX = centre.x * 0.5 + 0.5;
                const screenY = 0.5 - centre.y * 0.5;
                const insideX = screenX > board.x && screenX < board.x + board.width;
                const insideY = screenY > board.y && screenY < board.y + board.height;
                if (!insideX || !insideY) continue;
                const screenRadius = Math.abs(edge.project(camera).x - centre.x) * 0.5;
                const allowed = maxScreenRadiusAt(position.distanceTo(camera.position));
                if (screenRadius > allowed) {
                    crowders.push(
                        `${object.name || object.type}[${index}] `
                        + `r=${screenRadius.toFixed(3)} > ${allowed.toFixed(3)}`,
                    );
                }
            }
        });

        expect(crowders).toEqual([]);
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
