/**
 * Fall — the red squirrel's coat: its hair, in shells.
 *
 * The body (assets/squirrel.glb) is the squirrel under its coat. What makes it a squirrel and not a
 * figurine is the hair standing off that body: a soft edge the low sun shines through. It is drawn
 * here as shells: the same skinned mesh once more for every layer, each pushed out along the hair
 * (as long as the vertex's `_fur.x` says: deep on the haunches and the bib, close on the muzzle, none
 * on the eyes and pads, longest of all on the ear tufts and the plume) and leaning back along the
 * body the way a coat lies. Every layer shows the hairs that reach that high: a strand is a cell of
 * the body's rest position, with its own place, length and tone, thinning to its tip.
 *
 * The layers are blended, not cut: where a strand is finer than a pixel (always, at the size the game
 * shows it) a layer is the share of it the strands cover there, so the coat is a soft fringe that
 * neither sparkles nor steps as the squirrel moves. One instanced draw (the layer is the instance),
 * after everything solid; it writes no depth, so it only ever softens what is behind it.
 *
 * Lit as the grove is: wrapped sun, the sky, roots in the coat's own shade and tips that glow when
 * the low sun stands behind the animal.
 */

import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, cross, dot, float, floor, fract, fwidth, hash, instanceIndex, length, max, mix,
    normalize, normalLocal, normalWorld, positionLocal, positionWorld, pow, saturate, smoothstep, varying, vec2, vec3,
} from 'three/tsl';
import { flatVarying } from '../shared/flat-varying.js';

/** A vertex's own numbers as the fragment reads them, taken inside the covered part of the pixel. */
export const coveredVarying = (node, name) => varying(node, name).setInterpolation('perspective', 'centroid');

/** The longest hair (metres at life size): `_fur.x` is a share of it (scripts/blender/fall_squirrel/model.py). */
export const FUR_LONGEST = 0.02;
/** Layers of hair by quality tier (each is the body's triangles once more, blended). */
export const FUR_SHELLS = Object.freeze({
    Extreme: 24, Ultra: 20, High: 16, Medium: 12, Low: 8, Minimal: 6,
});
/** The layer count the strands' cover was tuned at: fewer layers each carry more of it. */
const REFERENCE_SHELLS = 16;
/** Strands a metre (life size): a hair every 0.8 mm or so. */
const DENSITY = 1250;
/** Locks of hair: turns of the grove's value noise a metre of body (life size; its finest lattice is 32 cells a turn). */
const LOCKS = 15;
/** How far the coat lies back along the body, of its length (the plume's hair stands straight out). */
const LEAN = 0.8;
/** The way the coat lies in the rest pose: back toward the tail and a little down. */
const BACK = new THREE.Vector3(0, -0.3, -1).normalize();

/**
 * The coat's shells for a squirrel's skinned body, on the body's own skeleton.
 * @param {object} o
 * @param {THREE.SkinnedMesh} o.body
 * @param {import('./fall-light.js').FallLight} o.light
 * @param {string} [o.quality]
 */
export function createFurShells({ body, light, quality = 'High' }) {
    if (!body?.geometry?.attributes?._fur) return null;
    const shells = FUR_SHELLS[quality] ?? FUR_SHELLS.High;
    const material = new THREE.MeshBasicNodeMaterial({
        fog: false, transparent: true, depthWrite: false,
    });
    material.name = 'FallSquirrelCoat';
    // (Read where the pixel is really covered: at the coat's outline a multisampled pixel is shaded at
    // its centre, off the triangle, and a colour extrapolated there is a black or red speck.)
    const coat = coveredVarying(attribute('_fur', 'vec4'), 'vFallCoatFur');
    const paint = coveredVarying(attribute('color', 'vec4'), 'vFallCoatPaint');
    const coatAtVertex = attribute('_fur', 'vec4');
    const restNormal = attribute('normal', 'vec3');
    const rest = attribute('position', 'vec3');
    // 0 at the skin to 1 at the hairs' ends: the instance is the layer.
    const height = float(instanceIndex).add(1).div(shells);
    const hair = saturate(coatAtVertex.x).mul(FUR_LONGEST);
    // The plume's hair (a half in _fur.w) stands out from its core; the body's coat lies back.
    const plume = smoothstep(0.3, 0.42, coatAtVertex.w).mul(smoothstep(0.7, 0.58, coatAtVertex.w));
    const lean = plume.oneMinus().mul(LEAN);
    // The lie of the coat in the rest pose, carried to the pose by the turn that took the rest
    // normal to the skinned one (a hair leans the same way along the body however it is bent).
    const skinned = normalize(normalLocal);
    const base = normalize(restNormal);
    const back = vec3(BACK.x, BACK.y, BACK.z);
    const lie = back.sub(base.mul(dot(back, base)));
    const turn = cross(base, skinned);
    const facing = max(dot(base, skinned).add(1), 0.08);
    const lying = lie.add(cross(turn, lie)).add(cross(turn, cross(turn, lie)).div(facing));
    const out = skinned.mul(hair.mul(height).mul(lean.mul(0.4).oneMinus()))
        .add(lying.mul(hair.mul(lean).mul(pow(height, 1.6))));
    material.positionNode = positionLocal.add(out);

    // -- the strands ----------------------------------------------------------------------
    const layer = flatVarying(height, 'vFallFurLayer');
    const q = rest.mul(DENSITY).add(4096);
    const cell = floor(q);
    const id = cell.x.mul(157).add(cell.y.mul(113)).add(cell.z.mul(271));
    const jitter = vec3(hash(id), hash(id.add(1)), hash(id.add(2))).sub(0.5).mul(0.6);
    const away = fract(q).sub(0.5).sub(jitter);
    const n = normalize(restNormal);
    const across = length(away.sub(n.mul(dot(away, n))));
    // The coat grows in locks: a few millimetres across and several long, lying the way the coat lies
    // (the rest position squeezed along that way, so the locks are streaks down the body). A lock has
    // its own length, which makes the outline tufted, and its own tone, which makes the coat a coat.
    const squeezed = rest.sub(back.mul(dot(rest, back)).mul(0.74));
    const lockA = light.noise(vec2(squeezed.x.add(squeezed.z.mul(0.55)), squeezed.y.add(squeezed.z.mul(0.31)))
        .mul(LOCKS));
    const lockB = light.noise(vec2(squeezed.z.sub(squeezed.x.mul(0.47)), squeezed.y.sub(squeezed.x.mul(0.29)))
        .mul(LOCKS * 1.37).add(0.37));
    const lock = lockA.b.add(lockB.b).mul(0.5);
    const tuft = lockA.a.add(lockB.a).mul(0.5);
    // (Value noise keeps to the middle of its range: spread it.)
    const lockLength = mix(float(0.52), float(1), smoothstep(0.3, 0.7, lock));
    const lockTone = mix(float(0.74), float(1.2), smoothstep(0.28, 0.72, tuft));
    const up = layer.div(lockLength);
    // Each strand its own length (a share of its lock's) and tone; it thins to its tip.
    const reach = hash(id.add(3)).mul(0.42).add(0.58);
    const toTip = saturate(up.div(reach));
    const radius = mix(float(0.5), float(0.15), toTip);
    const alive = smoothstep(1.0, 0.82, toTip);
    const strand = smoothstep(radius, radius.mul(0.5), across).mul(alive);
    // Finer than a pixel the strands are what they add up to: the share of the layer they cover.
    const grain = fwidth(q.x).add(fwidth(q.y)).add(fwidth(q.z));
    const fine = smoothstep(0.45, 1.3, grain);
    const stillOut = saturate(up.oneMinus().div(0.42));
    const meanRadius = mix(float(0.5), float(0.15), saturate(up.div(0.79)));
    const cover = saturate(meanRadius.mul(meanRadius).mul(2.6)).mul(stillOut);
    const density = mix(strand, cover, fine);
    // No hair where the coat has none (eyes, nose, pads); fewer layers each carry more.
    const grows = smoothstep(0.02, 0.09, coat.x);
    const alpha = saturate(density).mul(grows);
    material.opacityNode = alpha.oneMinus().pow(REFERENCE_SHELLS / shells).oneMinus();

    // -- its light ------------------------------------------------------------------------
    const world = positionWorld;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(world));
    const L = light.uSunDir;
    const sun = light.sunlight();
    const sky = saturate(paint.a);
    const through = saturate(coat.y);
    const tone = hash(id.add(4)).mul(0.3).add(0.86);
    // A hair is dark at its root and pale gold toward its tip.
    const along = pow(layer, 0.75);
    const dye = mix(vec3(0.5), vec3(1.16, 1.07, 0.9), along);
    const albedo = mix(vec3(dot(paint.rgb, vec3(0.2126, 0.7152, 0.0722))), paint.rgb, 0.84).mul(0.95)
        .mul(dye).mul(mix(tone, float(1), fine)).mul(lockTone);
    const wrap = saturate(dot(N, L).add(0.55).div(1.55));
    // Deep in the coat a hair stands in the shade of the hairs round it.
    const shade = mix(float(0.55), float(1), layer);
    const direct = albedo.mul(light.uSunColor).mul(wrap.mul(1.25)).mul(sun).mul(shade);
    const ambient = albedo.mul(light.ambient(N)).mul(sky.mul(0.7).add(0.3)).mul(shade.mul(0.6).add(0.4)).mul(1.4);
    // Against the light the ends of the hair shine: the bright edge all round a backlit squirrel.
    const behind = saturate(dot(V, L).negate());
    const grazing = saturate(dot(N, V)).oneMinus();
    const glow = pow(albedo, vec3(0.7)).mul(vec3(1.3, 1.05, 0.7));
    const shine = glow.mul(light.uSunColor)
        .mul(pow(behind, 1.6).mul(0.85).add(0.06))
        .mul(layer.mul(layer))
        .mul(grazing.mul(0.75).add(0.25))
        .mul(through.mul(0.6).add(0.4))
        .mul(sun.mul(0.85).add(0.15));
    const lit = direct.add(ambient).add(shine).add(glow.mul(light.uSunColor).mul(light.uWarmth.mul(0.03)));
    material.colorNode = light.haze(lit, { world });

    const mesh = new THREE.SkinnedMesh(body.geometry, material);
    mesh.name = 'FallSquirrelCoat';
    // (The layers are instances of the one draw.)
    mesh.count = shells;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // After the mist banks behind it (they are transparent too, and further off).
    mesh.renderOrder = 20;
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    mesh.scale.copy(body.scale);
    body.parent?.add(mesh);
    mesh.bind(body.skeleton, body.bindMatrix.clone());
    return {
        mesh,
        shells,
        triangles: (body.geometry.index ? body.geometry.index.count / 3 : 0) * shells,
        dispose() {
            mesh.removeFromParent();
            material.dispose();
        },
    };
}
