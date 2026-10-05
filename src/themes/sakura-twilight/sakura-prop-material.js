/**
 * Sakura Twilight — one material for everything people made.
 *
 * Stone, lacquer, vermilion and lit paper all come from the Blender pack with the same
 * vertex layout (colour = surface colour and baked occlusion, uv = glow weight and the
 * height inside the lit part), so the lanterns, the torii, the bridge, the pagoda, the
 * boulders and the lanterns the game sets afloat share this node graph.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, dot, exp, float, mix, normalWorld, normalize, positionGeometry, positionLocal,
    positionWorld, pow, saturate, sin, uv, varying, vec3, vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;

/**
 * `look`    optional per-instance vec4 node (flicker phase, red paper, glow strength, -)
 * `hung`    the piece swings from its origin in the wind (paper lanterns)
 * `place`   optional ({ local }) => vec3 node: where a vertex goes instead of where the
 *           instance matrix put it (floating and rising lanterns)
 * `glow`    scales the light of its paper; `tint` its surface colour
 */
export function createSakuraPropMaterial(light, name, {
    look = null, hung = false, place = null, glow = 1, tint = 1, shadowed = true,
} = {}) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = name;
    const paint = attribute('color', 'vec4'); // surface colour, occlusion
    const paper = uv(); // glow weight, height within the lit part
    const phase = look ? look.x : float(0.37);
    const t = light.uTime;
    if (place) {
        material.positionNode = place({ local: positionGeometry });
    } else if (hung) {
        // A lantern swings from its hook: the further below it, the further it moves.
        const force = light.uWind.add(light.uGust.mul(1.4));
        const swing = sin(t.mul(1.25).add(phase.mul(TAU))).mul(0.05)
            .add(sin(t.mul(2.9).add(phase.mul(19))).mul(0.018)).mul(force.add(0.25));
        const drop = positionGeometry.y.negate();
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x, 0, light.uWindDir.z).mul(swing.mul(drop)));
    }
    const world = positionWorld;
    const normal = normalize(normalWorld);
    const view = normalize(cameraPosition.sub(world));
    const albedo = paint.rgb.mul(tint);
    const occlusion = paint.a.mul(0.85).add(0.15);
    const facing = saturate(dot(normal, light.uMoonDir));
    const rim = pow(saturate(dot(normal, view)).oneMinus(), 3)
        .mul(saturate(dot(view, light.uMoonDir).negate().mul(0.6).add(0.5)));
    const lamp = varying(light.lamps(positionWorld, normalize(normalWorld)));
    const ring = varying(light.rings(positionWorld.xz).band);
    // The flame sits low in the paper and breathes.
    const flicker = sin(t.mul(7.3).add(phase.mul(TAU))).mul(sin(t.mul(3.1).add(phase.mul(11)))).mul(0.08).add(0.92);
    const flame = exp(paper.y.mul(-2.2)).mul(1.5).add(0.38);
    const paperColour = look ? mix(vec3(3.0, 1.42, 0.5), vec3(3.0, 0.42, 0.2), look.y) : vec3(3.0, 1.42, 0.5);
    const strength = look ? look.z : float(1);
    const lantern = paperColour.mul(paper.x).mul(flame).mul(flicker).mul(strength)
        .mul(glow)
        .mul(light.uLampGain.mul(0.5).add(0.5));
    const moon = shadowed ? light.moonlight() : float(1);
    const lit = albedo.mul(light.uMoonColor).mul(facing.mul(1.1).add(rim.mul(0.8))).mul(moon)
        .add(albedo.mul(light.ambient(normal)).mul(occlusion).mul(1.5))
        .add(albedo.mul(lamp).mul(occlusion).mul(paper.x.oneMinus()))
        .add(albedo.mul(vec3(1.0, 0.62, 0.76)).mul(ring).mul(0.7))
        .mul(paper.x.mul(0.7).oneMinus())
        .add(lantern);
    // fragmentNode, not colorNode: these cast into the moon's shadow map, and the shadow
    // pass would otherwise sample that map while drawing it (see sakura-forest.js).
    material.fragmentNode = vec4(light.haze(lit, { world }), 1);
    return material;
}
