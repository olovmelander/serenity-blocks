/**
 * Thermal Bloom — the backdrop: the basin's sky and its far rim, painted along every view ray
 * where nothing stands in front of it.
 *
 * Above the horizon, a high clean band of cerulean that pales through the season's haze only in
 * the last degrees above the rim (tbSky). No sun disc: the sun stands behind the camera's
 * shoulder and is never in frame. At the horizon, the far rim in two silhouettes by azimuth:
 * near, the dark lodgepole forest standing on the far edge of the apron (its base is hidden by
 * the basin's own edge), its crest ragged with tree tops; beyond it a low, flat-topped rhyolite
 * plateau, blue-white with distance. Both are seen through the basin's air (aerial perspective
 * toward the warm pearl), and their edges are anti-aliased by the pixel's angular size.
 * Below the rims (where the ground does not cover the frame) the pale apron, through its air.
 *
 * One far-plane triangle (vertexNode at z = w), drawn after the solids with the depth test on, so
 * it is shaded only where it shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    clamp,
    float,
    max,
    min,
    mix,
    positionGeometry,
    screenUV,
    select,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    tbAerial,
    tbPart,
    tbSky,
    tbViewRay,
} from './thermal-bloom-tsl.js';

/** The apron's colour at rest (linear): pale dry sinter. */
const APRON = vec3(0.62, 0.58, 0.48);
/** The far rim's distances (metres): the forest on the apron's edge, the plateau beyond. */
const FOREST_DIST = 3800;
/** The forest's own air: dense lodgepole reads dark, so it is seen through less haze than its distance. */
const FOREST_AIR = 2200;
const PLATEAU_DIST = 9000;

/**
 * The backdrop's light along a view direction.
 * @param {object} u    the shared uniforms
 * @param {object} dir  unit direction (vec3 node)
 * @param {object} tex  the world's baked textures (the noise atlas)
 * @returns {object} vec3 node (scene-linear HDR)
 */
export function tbBackdrop(u, dir, tex) {
    const el = dir.y.toVar();
    const az = atan(dir.x, dir.z.negate()).toVar();
    // A radian of the view covers this many pixels: silhouettes anti-alias over one of them.
    const px = max(u.pixelAngle, 1e-5);
    const crestNoise = (scale, row, level) => texture(tex.noise, vec2(az.mul(scale), row)).level(level);
    // The plateau: low and flat-topped (its crest is clamped into mesas), blue-white with distance.
    const plateauRaw = crestNoise(0.9, 0.31, 2).x;
    const plateau = float(0.007).add(min(plateauRaw.mul(0.035), 0.021)).toVar();
    // The forest: a ragged line of lodgepole tops along a gently rolling rim.
    const roll = crestNoise(2.2, 0.63, 1).y;
    const tops = crestNoise(60.0, 0.87, 0).z;
    const forest = float(0.0025).add(roll.mul(0.008)).add(tops.mul(0.0016)).toVar();
    const inForest = clamp(forest.sub(el).div(px).add(0.5), 0.0, 1.0);
    const inPlateau = clamp(plateau.sub(el).div(px).add(0.5), 0.0, 1.0);

    const sky = tbSky(u, dir);
    const plateauLit = mix(u.plateau, u.sunColor.mul(0.5), 0.12);
    const plateauCol = tbAerial(u, plateauLit, float(PLATEAU_DIST), dir);
    // Forest: dark blue-green, its sunlit tops a touch warmer, seen through ~4 km of air.
    const forestLit = u.rim.mul(float(0.38).add(smoothstep(0.0, 1.0, tops).mul(0.22)));
    const forestCol = tbAerial(u, forestLit, float(FOREST_AIR), dir);
    // Snow on the rim in the cold seasons.
    const snowy = mix(forestCol, tbAerial(u, vec3(0.75, 0.78, 0.82), float(FOREST_DIST), dir), u.snow.mul(0.35));
    const above = mix(mix(sky, plateauCol, inPlateau), snowy, inForest);

    // Below: the basin floor (y = 0) under the camera, seen through its air.
    const downY = min(dir.y, -1e-3);
    const dist = max(u.camPos.y, 1.0).div(downY.negate());
    const lit = APRON.mul(u.sunColor).mul(max(u.sunDir.y, 0.0).mul(0.9).add(0.35));
    const below = mix(tbAerial(u, lit, min(dist, float(FOREST_DIST)), dir), snowy, inForest);
    return select(dir.y.greaterThan(0.0), above, below);
}

/**
 * The backdrop part.
 * @param {object} u    the shared uniforms
 * @param {object} tier the quality tier
 * @param {object} tex  the world's baked textures
 */
export function createSky(u, tier, tex) {
    const backdropFn = Fn(() => {
        const d = tbViewRay(u, screenUV).toVar();
        return vec4(max(tbBackdrop(u, d, tex), vec3(0.0)), 1.0);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
    material.name = 'ThermalBloomSky';
    material.fog = false;
    material.depthFunc = THREE.LessEqualDepth;
    // At the far plane: anything solid in front of it keeps its pixels.
    material.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    material.colorNode = backdropFn();
    // Drawn after the solids among the opaque parts, so it is shaded only where it shows.
    return tbPart('ThermalBloomSky', geometry, material, 50);
}
