/**
 * Grainfields — four lines: the light that bursts through Lapporten's gate.
 *
 * Four lines tear the sky open over the gate and send a front of wind and light out of it over
 * the fields. Under the storm the tear itself is the picture; at the other hours there is no deck
 * to tear, and the front crosses twelve kilometres of land the crest hides. What the eye can see
 * from the barley at every hour is the gate itself: so the light stands in it, a fan of shafts
 * bursting out of the U between the two fells, across their dark faces and up into the sky, in the
 * hour's own light (pale gold under the storm, amber in the golden hour, rose at dusk).
 *
 * One quad facing the eye, on the eye's line to the gate but well in front of the fells (so the
 * shafts lie over their faces, and the trees, the ruin, the horses and the barley stand in front
 * of them). The fragment works in the quad's own polar frame: shafts by bearing round the gate
 * (two reads of the noise, each a whole number of tiles round the circle, so no seam), bright at
 * the gate and falling away outward, stronger below and beside it than above. Additive and
 * premultiplied (the target's alpha is left alone), no depth write.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    exp,
    float,
    length,
    mix,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec4,
} from 'three/tsl';
import { EYE } from './grainfields-core.js';
import { gateCentre } from './grainfields-lapporten.js';

/**
 * The fan: how far in front of the eye the quad stands (metres), how high over the U's floor its
 * heart is (the middle of the opening), and its half-size as the tangent of an angle from the eye.
 */
export const GATE_RAYS = Object.freeze({ distance: 5200, over: 330, reach: 0.44 });

export function createGateRays(u, t) {
    const centre = gateCentre([0, 0, 0]);
    centre[1] += GATE_RAYS.over;
    const to = new THREE.Vector3(centre[0] - EYE.x, centre[1] - EYE.y, centre[2] - EYE.z);
    const gateDistance = to.length();
    const at = new THREE.Vector3(EYE.x, EYE.y, EYE.z).addScaledVector(to, GATE_RAYS.distance / gateDistance);
    const half = GATE_RAYS.distance * GATE_RAYS.reach;
    const geometry = new THREE.PlaneGeometry(half * 2, half * 2);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsGateRays';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    material.side = THREE.DoubleSide;
    /** The burst's strength (0 … ~1.6 for stacked quads), written each frame. */
    const strength = uniform(0);
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const rho = length(q).toVar();
        const theta = atan(q.y, q.x).div(6.2832);
        // Shafts by bearing: broad ones and fine ones between them, drifting slowly as the light
        // moves in the gate (each read wraps a whole number of tiles round the circle).
        const broad = texture(t.noise, vec2(theta.mul(2.0).add(0.13), u.time.mul(0.011))).r;
        const fine = texture(t.noise, vec2(theta.add(0.61), float(0.4).sub(u.time.mul(0.017)))).g;
        const shafts = smoothstep(0.42, 0.66, broad.mul(0.62).add(fine.mul(0.38)));
        // Each shaft has its own reach (a gap in the gate's own cloud lets it run long or cuts it short).
        const reach = texture(t.noise, vec2(theta.mul(2.0).add(0.55), 0.83)).r.mul(1.5).add(0.35);
        // Out of the gate downward and to the sides, hardly at all up into the sky.
        const downward = smoothstep(0.45, -0.3, q.y.div(rho.max(1e-3)));
        const fan = shafts.mul(mix(float(0.12), float(1.0), downward)).mul(exp(rho.mul(-2.6).div(reach)))
            .mul(smoothstep(0.015, 0.1, rho));
        // The gate's own blaze, and a soft bloom of lit air round it.
        const heart = exp(rho.mul(rho).mul(-190.0)).mul(1.1).add(exp(rho.mul(rho).mul(-16.0)).mul(0.3));
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, rho));
        // The hour's own light: the glow round the sun and the clouds' lit sides.
        const light = u.glow.mul(0.85).add(u.cloudLit.mul(0.38));
        return vec4(light.mul(fan.mul(1.25).add(heart)).mul(edge).mul(strength).mul(0.55), 0.0);
    })();
    material.outputNode = vec4(material.colorNode.xyz, 0.0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsGateRays';
    mesh.position.copy(at);
    mesh.lookAt(EYE.x, EYE.y, EYE.z);
    mesh.frustumCulled = false;
    mesh.renderOrder = 24;
    mesh.visible = false;
    mesh.updateMatrixWorld();

    return {
        mesh,
        meshes: [mesh],
        strength,
        /** Where its heart stands (world), for tests and the playground. */
        at: at.toArray(),
        update(time, dt, world) {
            const s = world?.fx?.rays ?? 0;
            strength.value = s;
            mesh.visible = s > 0.002;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
