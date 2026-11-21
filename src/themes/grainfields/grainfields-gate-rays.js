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
    If,
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
    vec3,
    vec4,
} from 'three/tsl';
import { flashScale } from '../../utils/photosensitivity.js';
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
    const crown = uniform(0);
    const shaftsAt = Fn(([q]) => {
        const rho = length(q).toVar();
        const theta = atan(q.y, q.x).div(6.2832);
        // Shafts by bearing: broad ones and fine ones between them, drifting slowly as the light
        // moves in the gate (each read wraps a whole number of tiles round the circle).
        const broad = texture(t.noise, vec2(theta.add(0.13), u.time.mul(0.011))).level(2.0).r;
        const fine = texture(t.noise, vec2(theta.add(0.61), float(0.4).sub(u.time.mul(0.017)).add(rho.mul(0.09)))).level(2.0).g;
        const shafts = smoothstep(0.3, 0.79, broad.mul(0.71).add(fine.mul(0.29)));
        // Each shaft has its own reach (a gap in the gate's own cloud lets it run long or cuts it short).
        const reach = texture(t.noise, vec2(theta.add(0.55), 0.83)).level(2.0).r.mul(1.15).add(0.47);
        // Out of the gate downward and to the sides, hardly at all up into the sky.
        const downward = float(1.0).sub(smoothstep(-0.35, 0.55, q.y.div(rho.max(1e-3))));
        const fan = shafts.mul(mix(float(0.15), float(1.0), downward)).mul(exp(rho.mul(-2.4).div(reach)))
            .mul(smoothstep(0.012, 0.09, rho));
        // A bank of luminous mist lies across the floor of the U. The shafts
        // emerge along its width and dissolve over the faces of the fells.
        const across = q.mul(vec2(0.88, 2.0));
        const heart = exp(across.dot(across).mul(-86.0)).mul(0.68).add(exp(rho.mul(rho).mul(-12.0)).mul(0.15));
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, rho));
        // The hour's own light: the glow round the sun and the clouds' lit sides.
        const light = u.glow.mul(0.85).add(u.cloudLit.mul(0.38));
        const energy = strength.div(strength.mul(0.2).add(1.0));
        return light.mul(fan.mul(1.35).add(heart)).mul(edge).mul(energy).mul(0.59);
    });
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const light = vec3(0).toVar();
        If(strength.greaterThan(0.002), () => {
            light.addAssign(shaftsAt(q));
        });
        If(crown.greaterThan(0.002), () => {
            // The centre lies below the pass. Only the upper arc catches light; the feet disappear
            // gradually into the bank of mist. The separate soft bands overlap into a pearly core.
            const radius = length(q.sub(vec2(0.045, -0.26))).toVar();
            const shoulder = radius.sub(0.65).toVar();
            const inside = shoulder.add(0.037).div(0.058).toVar();
            const outside = shoulder.sub(0.037).div(0.066).toVar();
            const middle = shoulder.div(0.056).toVar();
            const warm = exp(outside.mul(outside).negate());
            const cool = exp(inside.mul(inside).negate());
            const pearl = exp(middle.mul(middle).negate());
            const colour = vec3(0.49, 0.29, 0.18).mul(warm)
                .add(vec3(0.20, 0.32, 0.51).mul(cool)).add(vec3(0.27, 0.30, 0.27).mul(pearl));
            const mist = texture(t.noise, q.mul(vec2(0.17, 0.08)).add(vec2(0.23, 0.68))
                .add(u.drift.mul(0.000009))).level(2.0).g;
            const wisps = texture(t.noise, q.mul(vec2(0.74, 0.24)).sub(u.drift.mul(0.000022))).level(1.5).b;
            const droplets = smoothstep(0.31, 0.66, mist.mul(0.74).add(wisps.mul(0.26))).mul(0.82).add(0.18);
            const foot = smoothstep(-0.085, 0.18, q.y);
            light.addAssign(colour.mul(droplets).mul(foot).mul(crown));
        });
        return vec4(light, 0.0);
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
        crown,
        /** Where its heart stands (world), for tests and the playground. */
        at: at.toArray(),
        update(time, dt, world) {
            const s = world?.fx?.rays ?? 0;
            strength.value = s;
            crown.value = (world?.fx?.clearSky ?? 0) * (0.5 + 0.5 * flashScale());
            mesh.visible = Math.max(s, crown.value) > 0.002;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
