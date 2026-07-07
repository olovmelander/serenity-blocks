/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// Chapter-3 butterflies — isolated material A/B harness.
//
// The butterflies were the ONE Ch3 particle that never got the .tsl.js soft-feather polish:
// they shipped as a raw OPAQUE MeshBasicMaterial in pure orange #FFAA00, so 20 hard garish
// squares tumbled near the path. This harness mounts a handful of butterfly quads with the
// SAME flap/heading animation the live chapter uses (updateSurfaceWorldEnvironment) so the
// material read can be screenshot-verified up close.
//
//   ?effect=ch3-butterflies&t=6            → AFTER (real createButterflyMaterialTSL, honey-amber feather)
//   ?effect=ch3-butterflies&t=6&variant=before  → BEFORE (exact old opaque orange square)
//
// The AFTER path imports the SHIPPING builder, so what you see here is what the chapter shows.
import * as THREE from 'three/webgpu';
import { createButterflyMaterialTSL } from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'ch3-butterflies',
    title: 'Ch3 Butterflies (material A/B)',
    description: 'Isolated butterfly material — old opaque orange square vs new soft honey-amber wing feather.',
};

export function create({ scene, params }) {
    const variant = params.get('variant') === 'before' ? 'before' : 'after';

    // Soft golden-hour sky backdrop so the amber wing reads against atmosphere (as in-chapter),
    // not against void — and so the BEFORE orange square is judged in a fair, representative field.
    scene.background = new THREE.Color(0x8ba6c2);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = variant === 'before'
        ? new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide }) // exact old material
        : createButterflyMaterialTSL();

    // A small flock at varied depths/phases so the same frame shows wings at several flap
    // angles (near-face + near-edge) — reveals both the silhouette and the colour/edge feather.
    const flock = [];
    const group = new THREE.Group();
    const N = 7;
    for (let i = 0; i < N; i += 1) {
        const mesh = new THREE.Mesh(geometry, material);
        const a = (i / N) * Math.PI * 2;
        mesh.userData = {
            baseX: Math.cos(a) * 3.4,
            baseY: Math.sin(a * 1.7) * 1.6,
            baseZ: Math.sin(a) * 2.2,
            speed: 0.5 + (i % 3) * 0.28,
            offset: a * 1.9,
            // ~chapter apparent size: 1u meshes seen from a few units away → small crisp flecks.
            scale: 0.85 + (i % 4) * 0.28,
        };
        mesh.scale.setScalar(mesh.userData.scale);
        group.add(mesh);
        flock.push(mesh);
    }
    scene.add(group);

    return {
        camera(time, camera) {
            camera.position.set(0, 0.5, 9);
            camera.lookAt(0, 0, 0);
            camera.fov = 50;
            camera.updateProjectionMatrix();
        },
        update(time) {
            flock.forEach((b) => {
                const ud = b.userData;
                const t = time * ud.speed + ud.offset;
                // Same motion language as the live chapter (scaled to this tight framing):
                // gentle drift + a fast wing flap on X + heading yaw on Y.
                b.position.x = ud.baseX + Math.sin(t * 0.5) * 0.6;
                b.position.y = ud.baseY + Math.cos(t * 0.3) * 0.4;
                b.position.z = ud.baseZ;
                b.rotation.x = Math.sin(t * 10) * 0.5;
                b.rotation.y = Math.atan2(Math.cos(t * 0.5), -Math.sin(t * 0.3));
            });
        },
        dispose() {
            scene.remove(group);
            geometry.dispose();
            material.dispose();
            scene.background = null;
        },
    };
}
