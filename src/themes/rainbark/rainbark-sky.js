/**
 * Rainbark — the backdrop: the air of the grove, painted along every view ray where no trunk
 * stands in front of it.
 *
 * What it paints so far is the zone's air with no grove in it:
 *  - the haze: blue-violet shade, warming to sunlit vapour toward the sun on the right
 *    (Henyey–Greenstein forward scatter), the light the air itself scatters (rbInscatter);
 *  - above, the canopy plane (yC): a dark lace of crown green over the zone's sky, seen through
 *    the haze from the walkway, so the frame darkens a touch toward its top edge;
 *  - below, the mist floor's top (y = tide): cream vapour, brighter where it faces the sun,
 *    seen through the haze, so the bottom of the frame brightens into a band of mist that
 *    dissolves into the air toward the horizon; from inside the mist, a vapour that darkens
 *    with depth.
 * Both planes are reached with the same closed-form air (rbAir), so the frame is continuous at
 * the horizon: a ray that grazes either plane has crossed so much air that it shows only haze.
 * The impostor ranks, the leaf lace, the billows and the floor come with the grove itself.
 *
 * One far-plane triangle (vertexNode at z = w), drawn after the solids with the depth test on, so
 * it is shaded only where it shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    float,
    max,
    min,
    mix,
    positionGeometry,
    screenUV,
    select,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import {
    rbAir,
    rbHgMix,
    rbInscatter,
    rbPart,
    rbViewRay,
} from './rainbark-tsl.js';

/** How much of the canopy plane the crowns cover at rest (the rest is sky). */
const CANOPY_COVER = 0.72;

/**
 * The backdrop's light along a view direction.
 * @param {object} u    the shared uniforms
 * @param {object} dir  unit direction (vec3 node)
 * @returns {object} vec3 node (scene-linear HDR)
 */
export function rbBackdrop(u, dir) {
    const sunward = dot(dir, u.sunDir).toVar();
    // Above: the canopy plane, crowns over sky (the zenith deepens the sky at Crown Light).
    const upY = max(dir.y, 1e-3);
    const tUp = max(u.canopyY.sub(u.camY), 1.0).div(upY);
    const atCanopy = u.camPos.add(dir.mul(tUp));
    const sky = mix(u.col.sky, u.col.zenith, clamp(dir.y, 0.0, 1.0));
    const crown = mix(sky, u.col.crown, CANOPY_COVER)
        .add(u.col.hazeSun.mul(rbHgMix(sunward, float(0.75)).mul(0.12)));
    const above = rbAir(u, crown, atCanopy);
    // Below: the mist floor's top, cream, brighter toward the sun.
    const downY = min(dir.y, -1e-3);
    const tDown = max(u.camY.sub(u.tide), 0.5).div(downY.negate());
    const atMist = u.camPos.add(dir.mul(tDown));
    const mist = u.col.mistTop.mul(0.92).add(u.col.hazeSun.mul(rbHgMix(sunward, float(0.6)).mul(0.25)));
    // Inside the mist (Mistfall, the Fog Line) there is no top to look down on: the vapour
    // darkens with depth instead, matching the air at the horizon so no line shows there.
    const interior = rbInscatter(u, dir).mul(float(1.0).sub(smoothstep(0.0, 0.6, dir.y.negate()).mul(0.35)));
    const inside = smoothstep(-2.0, 2.0, u.tide.sub(u.camY));
    const below = mix(rbAir(u, mist, atMist), interior, inside);
    return select(dir.y.greaterThan(0.0), above, below);
}

/**
 * The backdrop part.
 * @param {object} u  the shared uniforms
 */
export function createSky(u) {
    const backdropFn = Fn(() => {
        const d = rbViewRay(u, screenUV).toVar();
        return vec4(max(rbBackdrop(u, d), vec3(0.0)), 1.0);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
    material.name = 'RainbarkSky';
    material.fog = false;
    material.depthFunc = THREE.LessEqualDepth;
    // At the far plane: anything solid in front of it keeps its pixels.
    material.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    material.colorNode = backdropFn();
    // Drawn after the solids among the opaque parts, so it is shaded only where it shows.
    return rbPart('RainbarkSky', geometry, material, 50);
}
