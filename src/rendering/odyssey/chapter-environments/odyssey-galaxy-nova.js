/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview A NOVA IN THE GALAXY (2026-11-17, the Odyssey masterpiece pass).
 *
 * Space had nothing on the clock: the same orb showed the same sky on every visit. The spiral
 * galaxy (odyssey-spiral-galaxy.tsl.js) now and then holds a nova: one sun in its disc swells over
 * a few seconds to outshine its neighbours, holds, and sinks back over half a minute; the next one,
 * a minute and a half later, is somewhere else in the arms. A rare event at a great distance: one
 * point of light in the galaxy, with the faint cross a bright star wears. Slow (seconds up, tens of
 * seconds down): a pulse, never a flash, and still held back under Reduce flashing.
 *
 * `galaxyNovaAt` is the pure schedule. The mesh is one small quad riding on the galaxy (its child:
 * the chapter's staging fades it with the galaxy), sized on screen in pixels like the galaxy's suns.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraProjectionMatrix,
    cameraViewMatrix,
    exp,
    float,
    materialOpacity,
    max,
    modelWorldMatrix,
    positionGeometry,
    screenSize,
    smoothstep,
    uniform,
    uv,
    vec4,
} from 'three/tsl';
import { flashScale } from '../../../utils/photosensitivity.js';

export const GALAXY_NOVA = Object.freeze({
    /** Seconds from one nova's first light to the next one's. */
    period: 94,
    /** Seconds up, at its height, and down. */
    rise: 3.5,
    hold: 2.5,
    fall: 26,
    /** Where in the disc they fall: shares of its radius. */
    radius: Object.freeze([0.22, 0.78]),
    /** Its light at the height, and its size on screen (a share of the frame's height). */
    gain: 5.5,
    size: 0.03,
    /** What a nova keeps of its light under Reduce flashing (it is slow, but it is a swell). */
    reducedShare: 0.45,
    /** Draw order: after the galaxy's suns (-0.89), before the giant. */
    drawOrder: -0.885,
});

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/** A seeded number in [0, 1) for nova `n` (which, where, what colour never repeat in a row). */
function novaDice(n, salt) {
    const x = Math.sin((n * 127.1) + (salt * 311.7)) * 43758.5453;
    return x - Math.floor(x);
}

/**
 * The nova at `time`: its level 0..1, where in the disc it is (a share of the disc's radius and an
 * angle), and how warm it is (0 blue-white .. 1 gold).
 * @param {number} time seconds
 * @returns {{ level: number, radius: number, angle: number, warm: number, index: number }}
 */
export function galaxyNovaAt(time) {
    const N = GALAXY_NOVA;
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    const index = Math.floor(t / N.period);
    const into = t - (index * N.period);
    const level = smooth01(into / N.rise) * (1 - smooth01((into - N.rise - N.hold) / N.fall));
    return {
        level,
        radius: N.radius[0] + ((N.radius[1] - N.radius[0]) * novaDice(index, 1)),
        // The golden angle on from the last, with a little of its own.
        angle: (index * 2.39996) + (novaDice(index, 2) * 0.9),
        warm: novaDice(index, 3),
        index,
    };
}

/**
 * The nova's quad, to be added to the galaxy's mesh (whose disc faces +Z, `discRadius` across).
 * @param {number} discRadius the galaxy disc's radius in the mesh's own units
 * @returns {{ mesh: THREE.Mesh, update: (time: number) => void, dispose: () => void }}
 */
export function createGalaxyNova(discRadius) {
    const uLevel = uniform(0);
    const uWarm = uniform(0.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'Odyssey galaxy nova';
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.fog = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.forceSinglePass = true;
    material.userData.emitsBloom = true;
    // A quad of a fixed size on screen round the nova's place (the mesh's own origin).
    material.vertexNode = Fn(() => {
        const world = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        const px = screenSize.y.mul(GALAXY_NOVA.size);
        const half = screenSize.mul(0.5);
        return vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    })();
    // Added light, written whole (premultiplied: a colorNode would be multiplied by an alpha of 0).
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d2 = q.dot(q).toVar();
        // A point, its glow, and the thin cross of a bright star, all inside the quad.
        const core = exp(d2.mul(-260.0)).mul(1.6).add(exp(d2.mul(-28.0)).mul(0.22));
        const spikes = exp(abs(q.x).mul(-70.0)).mul(exp(abs(q.y).mul(-5.5)))
            .add(exp(abs(q.y).mul(-70.0)).mul(exp(abs(q.x).mul(-5.5))))
            .mul(0.3);
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, max(abs(q.x), abs(q.y))));
        const cool = vec4(0.7, 0.84, 1.0, 0.0);
        const gold = vec4(1.0, 0.86, 0.62, 0.0);
        const tint = cool.add(gold.sub(cool).mul(uWarm));
        return tint.mul(core.add(spikes).mul(edge).mul(uLevel).mul(GALAXY_NOVA.gain)
            .mul(materialOpacity));
    })();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'spiral-galaxy-nova';
    mesh.frustumCulled = false;
    mesh.renderOrder = GALAXY_NOVA.drawOrder;
    return {
        mesh,
        update(time) {
            const nova = galaxyNovaAt(time);
            const r = nova.radius * discRadius;
            mesh.position.set(Math.cos(nova.angle) * r, Math.sin(nova.angle) * r, 0);
            const share = flashScale() < 1 ? GALAXY_NOVA.reducedShare : 1;
            uLevel.value = nova.level * share;
            uWarm.value = nova.warm;
            // Always drawn (a quad a few pixels across that adds nothing between novae): hidden
            // until its first light, its pipeline would be built on the frame it first shone.
            mesh.userData.level = uLevel.value;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
