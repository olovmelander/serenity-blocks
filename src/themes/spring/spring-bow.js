/**
 * Spring — the rainbow.
 *
 * Sunlight turned back by rain leaving down the valley: a band at the bow's true angles from the
 * point opposite the sun (spring-light.js sprayBow: the primary 40.3°–42.4°, the fainter secondary
 * 50.4°–53.5° with its colours reversed, the sky inside the primary a little brighter), so it
 * stands where a rainbow would: over the fall in the morning, low over the fells in the afternoon,
 * and nowhere when the sun stands ahead of the eye or too high (the world gates its strength,
 * spring-weather.js bowLight). The bow in the fall's own spray (spring-mist.js) is drawn at the
 * same angles, so the two join.
 *
 * One ring of quads about the eye, a kilometre and a half out (the rain's distance): what stands
 * nearer hides it, the far fells stand behind it. Its place follows the sun in the vertex stage;
 * nothing is written per frame. Light that adds: premultiplied, alpha left alone.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    cross,
    float,
    normalize,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG } from './spring-core.js';
import { airClarity, sprayBow } from './spring-light.js';

/**
 * The ring: the angles from the point opposite the sun it spans (degrees), how far out it stands
 * (m), its segments round and across, and how bright the bow is (times the sun's light).
 */
export const SKY_BOW = Object.freeze({
    from: 37, to: 56, distance: 1500, around: 96, across: 6, gain: 0.115,
});

export function createBow(u, tex) {
    const { around, across } = SKY_BOW;
    const ring = [];
    const index = [];
    // The upper part of the circle and a little under the level line either side: the rest lies
    // in the ground.
    for (let j = 0; j <= across; j++) {
        for (let i = 0; i <= around; i++) ring.push(-0.16 + 1.32 * (i / around), j / across);
    }
    const stride = around + 1;
    for (let j = 0; j < across; j++) {
        for (let i = 0; i < around; i++) {
            const a = j * stride + i;
            index.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((ring.length / 2) * 3), 3));
    geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 2));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringBow';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    const at = attribute('aRing', 'vec2');
    // (degrees from the point opposite the sun, how far round the circle, the height's sine)
    const vBow = varying(vec3(0.0), 'spBow');
    const vPlace = varying(vec3(0.0), 'spBowPlace');
    material.vertexNode = Fn(() => {
        const axis = normalize(u.sunDir.negate());
        // Round the axis: level across, then up.
        const level = normalize(cross(axis, vec3(0.0, 1.0, 0.0)).add(vec3(1e-5, 0.0, 0.0)));
        const up = cross(level, axis);
        const theta = at.y.mul(SKY_BOW.to - SKY_BOW.from).add(SKY_BOW.from).toVar();
        const phi = at.x.mul(Math.PI);
        const dir = axis.mul(cos(theta.mul(DEG)))
            .add(level.mul(cos(phi)).add(up.mul(sin(phi))).mul(sin(theta.mul(DEG)))).toVar();
        const place = u.eye.add(dir.mul(SKY_BOW.distance)).toVar();
        vBow.assign(vec3(theta, at.x, dir.y));
        vPlace.assign(place);
        // No bow, no fragments: the ring is clipped away whole (its pipeline is made with the
        // world's others, so the first bow of a session costs no compile).
        return u.sky2.x.greaterThan(0.004)
            .select(cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(place, 1.0))), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = Fn(() => {
        const bow = sprayBow(vBow.x);
        // Rain is never even: the bow stands brighter in one stretch than the next, and brightest
        // toward its feet; under the level line it thins away over the far ground.
        const uneven = texture(tex.noise, vec2(vBow.y.mul(1.7), u.time.mul(0.004))).r.mul(0.7).add(0.55);
        const feet = float(1.0).sub(smoothstep(0.02, 0.5, vBow.z).mul(0.35));
        const ground = smoothstep(-0.07, 0.015, vBow.z);
        const light = u.sun.mul(u.sunUp).mul(u.sky2.x.mul(SKY_BOW.gain)).mul(uneven).mul(feet)
            .mul(ground)
            .mul(airClarity(u, vPlace).mul(0.5).add(0.5));
        return vec4(bow.mul(light), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringBow';
    mesh.frustumCulled = false;
    mesh.renderOrder = 13;
    return {
        mesh,
        meshes: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
