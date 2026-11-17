/**
 * Neon District — passers-by.
 *
 * Now and then something flies down the street past the camera, low between the walls
 * (neon-district-night.js: flybyAt says what, where and when): a cab, a patrol with its lights
 * turning, a freighter hung with marker lamps, a string of courier drones. Each is ONE card that
 * faces the camera: a dark hull cut out of the night (it covers what is behind it), its lamps and
 * windows burning on it, its thrusters lighting the rain under it. The light it throws on the
 * walls and the road as it goes by is the district's own (neon-district-tsl.js: ndGlow reads
 * `u.pass`), so the wet street mirrors it and the rain catches it.
 *
 * Always drawn (a dormant card collapses to nothing), so the first frame compiles its pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    ndFogAmount, ndFxMaterial, ndGlow, ndHaze, ndQuadGeometry,
} from './neon-district-tsl.js';

/** The card is this many hull lengths wide and hull heights tall (room for the glow round it). */
const CARD = Object.freeze({ wide: 1.7, tall: 3.4 });

/**
 * @param {object} u  shared district uniforms
 */
export function createFlyby(u) {
    const geometry = ndQuadGeometry(1, {});
    const uniforms = {
        /** (x, y, z, how lit 0..1) */
        place: uniform(new THREE.Vector4(0, 8, -20, 0)),
        /** (kind 0..3, which way it flies ±1, hull length as seen, hull height) */
        shape: uniform(new THREE.Vector4(0, 1, 5, 1.7)),
        lamp: uniform(new THREE.Vector3(1, 0.74, 0.3)),
        glow: uniform(new THREE.Vector3(1, 0.62, 0.22)),
    };
    const material = ndFxMaterial('NeonDistrictFlyby');
    const centre = uniforms.place.xyz;
    const lit = uniforms.place.w;
    const hullL = uniforms.shape.z;
    const hullH = uniforms.shape.w;
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre, 1.0));
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const sizePx = vec2(hullL.mul(CARD.wide), hullH.mul(CARD.tall)).mul(pxPerMetre).mul(step(0.004, lit));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);
    const dist = length(centre.sub(cameraPosition));
    const vAir = varying(float(1.0).sub(ndFogAmount(dist, centre.y)), 'ndFlybyAir');
    const vStreet = varying(ndGlow(u, centre), 'ndFlybyStreet');
    const vHaze = varying(ndHaze(u, centre.sub(cameraPosition)), 'ndFlybyHaze');
    // The card's left is the way the screen's left lies: which end leads depends on the way it
    // flies and the side of the street it is on.
    const lead = uniforms.shape.y.mul(mix(float(1.0), float(-1.0), step(0.0, centre.x)));

    material.colorNode = Fn(() => {
        const kind = floor(uniforms.shape.x.add(0.5));
        const is = (k) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
        const isCab = is(0);
        const isPatrol = is(1);
        const isFreighter = is(2);
        const isCouriers = is(3);
        // Metres from the hull's middle: x toward the nose, y up.
        const card = uv().sub(0.5).mul(vec2(hullL.mul(CARD.wide), hullH.mul(CARD.tall)));
        const p = vec2(card.x.mul(lead), card.y);
        const sq = (v) => v.mul(v);
        const halfL = hullL.mul(0.5);
        const halfH = hullH.mul(0.5);
        const aa = float(1.5).div(pxPerMetre);

        // ── The hull: a rounded box, a cabin on the cab and the patrol, ribs on the freighter ──
        const round = halfH.mul(mix(float(0.72), float(0.3), isFreighter));
        const q = abs(p).sub(vec2(halfL, halfH)).add(round);
        const box = length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(round);
        const cabin = length(vec2(p.x.add(halfL.mul(0.1)).div(halfL.mul(0.55)), p.y.sub(halfH.mul(0.75)).div(halfH.mul(0.95))))
            .sub(1.0)
            .mul(halfH.mul(0.8));
        const body = mix(box, min(box, cabin), isCab.add(isPatrol));
        const hull = float(1.0).sub(smoothstep(aa.negate(), aa, body)).mul(float(1.0).sub(isCouriers));
        const ribs = mix(float(1.0), step(0.16, fract(p.x.mul(0.9))).mul(0.45).add(0.55), isFreighter);
        // Dark metal: what little it shows is the street's light on its belly and the sky's on its back.
        const up = clamp(p.y.div(halfH), -1.0, 1.0);
        const metal = vec3(0.03, 0.033, 0.042).mul(ribs)
            .mul(vStreet.mul(float(1.0).sub(up).mul(0.9)).add(vHaze.mul(up.add(1.0)).mul(1.6)).add(0.05));
        // Windows: a lit band along the cabin (the freighter has none, the couriers no hull).
        const band = step(abs(p.y.sub(halfH.mul(0.62))), halfH.mul(0.26))
            .mul(step(abs(p.x.add(halfL.mul(0.08))), halfL.mul(0.42)))
            .mul(step(0.1, fract(p.x.mul(1.5))))
            .mul(isCab.add(isPatrol));
        const blob = (at, r) => exp(sq(length(p.sub(at)).div(r)).negate());
        // Head lamps at the nose, tail lamps behind, marker lamps down the freighter's flank.
        const nose = blob(vec2(halfL.mul(0.96), halfH.mul(-0.1)), halfH.mul(0.2).add(0.06));
        const tail = blob(vec2(halfL.mul(-0.98), float(0.0)), halfH.mul(0.17).add(0.05));
        const markers = exp(sq(p.y.add(halfH.mul(0.55)).div(0.07)).negate())
            .mul(exp(sq(fract(p.x.mul(0.5)).sub(0.5).div(0.045)).negate()))
            .mul(step(abs(p.x), halfL))
            .mul(isFreighter);
        // Thrusters under the hull: two burning cold, the rain lit below them.
        const flick = sin(u.time.mul(31.0)).mul(0.08).add(0.92);
        const jets = blob(vec2(halfL.mul(0.5), halfH.mul(-1.08)), halfH.mul(0.24).add(0.05))
            .add(blob(vec2(halfL.mul(-0.5), halfH.mul(-1.08)), halfH.mul(0.24).add(0.05)))
            .mul(flick)
            .mul(float(1.0).sub(isCouriers));
        const wash = exp(sq(p.x.div(halfL.mul(1.1))).negate())
            .mul(smoothstep(halfH.mul(-3.2), halfH.mul(-1.0), p.y))
            .mul(step(p.y, halfH.mul(-0.9)))
            .mul(float(1.0).sub(isCouriers))
            .mul(0.06);
        // The patrol's bar turns from red to blue and back, slowly (a swell, never a strobe).
        const turnTo = sin(u.time.mul(5.2)).mul(0.5).add(0.5);
        const bar = blob(vec2(halfL.mul(-0.05), halfH.mul(1.72)), halfH.mul(0.2)).mul(isPatrol);
        const barCol = mix(vec3(1.0, 0.08, 0.1), vec3(0.12, 0.3, 1.0), turnTo);
        // The couriers: a string of small drones, each a lamp and a dark speck, bobbing.
        const slot = floor(p.x.div(hullL.div(7.0)).add(3.5));
        const cx = slot.sub(3.0).mul(hullL.div(7.0));
        const bob = sin(u.time.mul(3.0).add(slot.mul(1.9))).mul(0.28);
        const drone = exp(sq(length(p.sub(vec2(cx, bob))).div(0.13)).negate())
            .mul(step(abs(slot.sub(3.0)), 3.5))
            .mul(isCouriers);

        // The hull's edge catches the street: without it a dark hull in a dark street is nothing.
        const rim = smoothstep(halfH.mul(-0.3), float(0.0), body).mul(hull);
        const light = uniforms.lamp.mul(band.mul(hull).mul(1.15))
            .add(vStreet.mul(0.14).add(uniforms.glow.mul(0.04)).mul(rim))
            .add(vec3(0.85, 0.92, 1.0).mul(nose).mul(float(1.0).sub(isCouriers)).mul(2.4))
            .add(vec3(1.0, 0.1, 0.06).mul(tail).mul(float(1.0).sub(isCouriers)).mul(1.7))
            .add(uniforms.lamp.mul(markers).mul(1.8))
            .add(vec3(0.6, 0.85, 1.0).mul(jets).mul(1.1))
            .add(uniforms.glow.mul(wash))
            .add(barCol.mul(bar).mul(2.2))
            .add(uniforms.glow.mul(drone).mul(2.2));
        const shown = lit.mul(vAir);
        const alpha = hull.mul(shown);
        return vec4(metal.mul(alpha).add(light.mul(shown)), alpha);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDistrictFlyby';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 21;
    return {
        mesh, material, geometry, uniforms,
    };
}
