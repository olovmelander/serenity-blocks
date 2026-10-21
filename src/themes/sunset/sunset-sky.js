/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — the sky over the western sea: one dome that draws skyColour (sunset-tsl.js) along the
 * view ray, and under the horizon the air over the far sea.
 *
 * Drawn last among the opaque parts with the depth test on: it is shaded only where the sea and
 * the lanterns let the sky show.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, float, mix, normalize, positionGeometry, smoothstep, vec4,
} from 'three/tsl';
import { horizonHaze, skyColour } from './sunset-tsl.js';

export function createSky({ tier, noise, U }) {
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    material.name = 'sunset-sky';
    material.colorNode = Fn(() => {
        const dir = normalize(positionGeometry).toVar();
        const sky = skyColour(dir, U, noise, {
            slices: tier.slices,
            fine: tier.fine,
            cirrus: tier.cirrus,
            bars: tier.bars,
            discs: true,
            stars: true,
            milky: tier.milky,
            rays: true,
        });
        const below = float(1.0).sub(smoothstep(-0.002, 0.0, dir.y));
        return vec4(mix(sky, horizonHaze(dir, U), below), 1.0);
    })();

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), material);
    mesh.name = 'sunset-sky';
    mesh.scale.setScalar(30000);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return {
        mesh,
        /** The dome rides with the lens. */
        follow(camera) {
            mesh.position.copy(camera.position);
            mesh.updateMatrixWorld();
        },
        dispose() {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
