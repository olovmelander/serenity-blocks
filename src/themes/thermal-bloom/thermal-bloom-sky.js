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
    Loop,
    atan,
    clamp,
    exp,
    float,
    int,
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
    tbFarApron,
    tbPart,
    tbSky,
    tbViewRay,
} from './thermal-bloom-tsl.js';

/** The far rim's distances (metres): the forest on the apron's edge, the plateau beyond. */
const FOREST_DIST = 3800;
/** The forest's own air: dense lodgepole reads dark, so it is seen through less haze than its distance. */
const FOREST_AIR = 320;
const PLATEAU_DIST = 9000;
/** The far range beyond the plateau (the rim's third, palest layer). */
const RANGE_DIST = 26000;
/** The deepest the rim's forested face reaches under the horizon (radians, about half a degree). */
const FOREST_FACE = -0.008;

/**
 * The backdrop's light along a view direction.
 * @param {object} u    the shared uniforms
 * @param {object} dir  unit direction (vec3 node)
 * @param {object} tex  the world's baked textures (the noise atlas)
 * @returns {object} vec3 node (scene-linear HDR)
 */
export function tbBackdrop(u, dir, tex, ghosts = false) {
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
    const forest = float(0.0045).add(roll.mul(0.01)).add(tops.mul(0.002)).toVar();
    // The forest stands on the apron's far edge: below its base (a little under the horizon from
    // this height) the ground shows, not the trees.
    // From a high camera the rim's hills would fill degrees under the horizon: cap the face we
    // draw at about half a degree and let the far apron (hazed by its distance) show below it.
    const base = max(u.camPos.y.div(FOREST_DIST).negate(), FOREST_FACE);
    const inForest = clamp(forest.sub(el).div(px).add(0.5), 0.0, 1.0)
        .mul(clamp(el.sub(base).div(px).add(0.5), 0.0, 1.0));
    const inPlateau = clamp(plateau.sub(el).div(px).add(0.5), 0.0, 1.0);
    // The far range: peaked, taller than the plateau in places, nearly lost in the haze.
    const rangeRaw = crestNoise(0.45, 0.07, 2).y;
    const range = float(0.005).add(rangeRaw.mul(rangeRaw).mul(0.042)).toVar();
    const inRange = clamp(range.sub(el).div(px).add(0.5), 0.0, 1.0);

    const sky = tbSky(u, dir).toVar();
    // Cirrus: slow, thin wisps on a plane far above, stretched along the high wind, sunlit.
    const cp = dir.xz.div(max(el, 0.045)).mul(0.07).add(vec2(u.time.mul(0.0015), u.time.mul(0.0006)));
    const cuv = vec2(cp.x.add(cp.y.mul(0.35)), cp.y.mul(3.0).sub(cp.x.mul(0.55)));
    const wispA = texture(tex.noise, cuv.mul(vec2(0.3, 1.0))).x;
    const wispB = texture(tex.noise, cuv.mul(1.6).add(0.31)).z;
    const wisp = smoothstep(0.56, 0.86, wispA).mul(smoothstep(0.35, 0.75, wispB))
        .mul(smoothstep(0.02, 0.1, el)).mul(float(1.0).sub(smoothstep(0.55, 0.95, el)));
    sky.assign(mix(sky, u.sunColor.mul(0.92).add(u.zenith.mul(0.22)), wisp.mul(0.42)));
    const rangeLit = mix(u.plateau, u.sunColor.mul(0.62), 0.25).add(vec3(0.2).mul(u.snow));
    const rangeCol = mix(rangeLit, tbAerial(u, rangeLit, float(RANGE_DIST), dir), 0.8);
    // The plateau: a distinct blue-grey step behind the forest, paler with its distance.
    const plateauLit = mix(u.plateau, u.sunColor.mul(0.55), 0.1);
    const plateauCol = mix(plateauLit, tbAerial(u, plateauLit, float(PLATEAU_DIST), dir), 0.55);
    // Forest: the lodgepole's dark blue-green, its crowns catching the sun on their left flanks,
    // seen through ~10% of haze.
    // Crowns as clumps (they vary with height too, so they never comb into vertical streaks),
    // stands lighter and darker along the rim, and a haze skirt where the trunks meet the apron.
    const crowns = texture(tex.noise, vec2(az.mul(140.0), el.mul(900.0).add(0.43))).level(0).w;
    const stands = crestNoise(7.0, 0.19, 1).x;
    const forestLit = u.rim.mul(float(0.32).add(smoothstep(0.3, 0.9, crowns).mul(0.3)).add(stands.mul(0.45)))
        .add(u.sunColor.mul(smoothstep(0.75, 1.0, tops).mul(0.02)))
        .toVar();
    // First Frost: aspens flame gold in a few groves along the rim (a quarter of it or so), each
    // broken into rounded clumps among the dark pines — never a comb of single crowns.
    const clumps = texture(tex.noise, vec2(az.mul(55.0), el.mul(160.0).add(0.29))).level(0).z;
    // (the clumps fray the grove's edge, so it never ends in a straight vertical cut)
    const grove = smoothstep(0.55, 0.72, crestNoise(2.6, 0.71, 1).y.add(clumps.sub(0.5).mul(0.3)));
    const aspens = grove.mul(smoothstep(0.38, 0.6, clumps)).mul(u.frost).mul(float(1.0).sub(u.snow));
    forestLit.assign(mix(forestLit, mix(vec3(0.5, 0.31, 0.05), vec3(0.52, 0.2, 0.04), stands), aspens));
    const skirt = float(1.0).sub(smoothstep(0.0, 0.0035, el.sub(base)));
    const forestCol = tbAerial(u, forestLit, mix(float(FOREST_AIR), float(FOREST_DIST), skirt), dir);
    // Snow on the rim in the cold seasons.
    const snowy = mix(forestCol, tbAerial(u, vec3(0.75, 0.78, 0.82), float(FOREST_DIST), dir), u.snow.mul(0.35));
    const above = mix(mix(mix(sky, rangeCol, inRange), plateauCol, inPlateau), snowy, inForest);

    // Below: the far apron beyond the basin's mesh, seen through its air, up to the forest's foot,
    // where a ragged strip of rim meadow (the season's: green, straw gold, gold, snow) meets the trees.
    const downY = min(dir.y, -1e-3);
    const dist = max(u.camPos.y, 1.0).div(downY.negate());
    const apron = tbFarApron(u, min(dist, float(FOREST_DIST)), dir).toVar();
    const meadowEdge = base.sub(crestNoise(9.0, 0.53, 1).x.mul(0.006).add(0.002));
    const inMeadow = clamp(el.sub(meadowEdge).div(px).add(0.5), 0.0, 1.0);
    const meadowLit = u.meadow.mul(u.sunColor.mul(0.95).add(mix(u.haze, u.zenith, 0.6).mul(0.3)));
    const meadowTone = mix(float(0.82), float(1.08), crestNoise(31.0, 0.37, 0).y);
    apron.assign(mix(apron, tbAerial(u, meadowLit.mul(meadowTone), float(FOREST_DIST * 0.6), dir), inMeadow.mul(0.85)));
    const below = mix(apron, snowy, inForest);
    const out = select(dir.y.greaterThan(0.0), above, below).toVar();
    if (ghosts) {
        // Far columns the tier keeps no sheets for (§1.7: every tier keeps the whole picture):
        // soft stems widening into billows, pearl on the sun's side, seen through the air.
        const ghost = float(0.0).toVar();
        Loop({
            start: int(0), end: u.ghostCount, type: 'int', condition: '<', name: 'gh',
        }, ({ gh }) => {
            const G = u.ghosts.element(gh);
            const lift = el.sub(G.y).div(max(G.w.sub(G.y), 1e-4));
            const dx = az.sub(G.x).div(max(G.z.mul(lift.mul(1.6).add(0.5)), 1e-4));
            const n = texture(tex.noise, vec2(dx.mul(0.35), lift.mul(2.2).sub(u.time.mul(0.03))).div(4.0)).x;
            const body = exp(dx.mul(dx).negate()).mul(smoothstep(0.0, 0.06, lift))
                .mul(float(1.0).sub(smoothstep(0.5, 1.0, lift)));
            ghost.assign(max(ghost, body.mul(smoothstep(0.28, 0.7, n))));
        });
        const lit = u.sunColor.mul(0.78).add(mix(u.haze, u.zenith, 0.5).mul(0.15));
        out.assign(mix(out, tbAerial(u, lit, float(2500.0), dir), ghost.mul(0.42).mul(u.steam)));
    }
    return out;
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
        return vec4(max(tbBackdrop(u, d, tex, tier.plumes < 8), vec3(0.0)), 1.0);
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
