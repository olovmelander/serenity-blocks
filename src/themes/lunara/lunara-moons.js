/**
 * Lunara — the twin moons.
 *
 * The great moon and its rose companion are spheres on a far shell that follows the camera; the
 * companion circles the great moon, passing in front of it and behind. Both are lit by the same
 * unseen sun, so they show the same phase, with relief along the terminator (two extra taps of
 * the moon map give the slope), a dark side that still stands against the sky, and a thin rim of
 * lit atmosphere.
 *
 * The great moon answers the board: as a chain of clears builds, veins of light open across its
 * face from the centre outward, and a four-line clear fires them all.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    cross,
    dot,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import {
    luBell, luLuma, luPart, luSkyBase,
} from './lunara-tsl.js';

/** Distance of the shell the moons hang on (inside the sky dome, beyond every mountain). */
export const MOON_DISTANCE = 5200;

/**
 * @param {object} u       shared valley uniforms
 * @param {object} map     texture node of the moon map (a placeholder until it arrives)
 * @param {object} mapFade uniform 0..1: how much of the map has faded in
 * @param {object} opts
 * @param {boolean} opts.companion  the rose moon: no veins, its own colour and face
 * @param {boolean} [opts.relief=true]  two more taps for the terminator's relief
 */
export function createMoon(u, map, mapFade, { companion = false, relief = true } = {}) {
    const uniforms = {
        /** The moon's centre in the world, and its radius. */
        place: uniform(new THREE.Vector4(0, 1000, -MOON_DISTANCE, 500)),
        /** How far the map has turned (the moon's slow spin). */
        turn: uniform(companion ? 0.21 : 0.5),
    };
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = companion ? 'LunaraCompanion' : 'LunaraMoon';
    material.fog = false;

    material.colorNode = Fn(() => {
        const N = normalize(positionWorld.sub(uniforms.place.xyz)).toVar();
        const toCam = normalize(cameraPosition.sub(positionWorld)).toVar();
        const ndv = max(dot(N, toCam), 0.0).toVar();
        const st = uv().add(vec2(uniforms.turn, 0.0)).toVar();
        const tone = (at) => luLuma(map.sample(at).rgb);
        const lum = mix(float(0.5), tone(st), mapFade).toVar();

        // Relief: the map's own slope tilts the normal, so craters throw shade near the terminator.
        const Nb = N.toVar();
        if (relief) {
            const e = 1 / 900;
            const du = tone(st.add(vec2(e, 0.0))).sub(lum);
            const dv = tone(st.add(vec2(0.0, e))).sub(lum);
            const east = normalize(cross(vec3(0.0, 1.0, 0.0), N));
            const north = cross(N, east);
            Nb.assign(normalize(N.sub(east.mul(du).add(north.mul(dv)).mul(mapFade).mul(companion ? 2.6 : 3.2))));
        }
        const ndl = dot(Nb, u.sunDir);
        const day = smoothstep(-0.05, 0.3, ndl).mul(max(ndl, 0.0).mul(0.5).add(0.5)).toVar();

        const own = companion ? u.companionCol : u.moonCol;
        // Low ground keeps the moon's hue, high ground pales toward white.
        const ground = mix(own.mul(own).mul(0.6), mix(own, vec3(1.0), 0.16), smoothstep(0.2, 0.85, lum));
        const body = ground.mul(lum.mul(1.05).add(0.22));
        const limb = pow(ndv, 0.5);
        const col = body.mul(day.mul(limb).mul(companion ? 1.25 : 0.92).add(0.02)).toVar();

        // A thin atmosphere: a lit rim, brighter on the day side.
        const rim = pow(float(1.0).sub(ndv), 3.2);
        col.addAssign((companion ? own : u.glow.add(own.mul(0.4))).mul(rim).mul(day.mul(0.7).add(0.1)).mul(0.6));

        if (!companion) {
            // Veins of light: iso-lines of the noise, opening from the centre of the face outward.
            const vst = st.mul(vec2(6.0, 3.0));
            const n1 = u.noise(vst).r;
            const n2 = u.noise(vst.mul(2.6).add(vec2(0.37, 0.11))).g;
            const cracks = luBell(n1.sub(0.5).mul(34.0)).add(luBell(n2.sub(0.5).mul(40.0)).mul(0.55));
            const open = smoothstep(u.veins.mul(1.25), u.veins.mul(1.25).sub(0.4), float(1.0).sub(ndv));
            const throb = sin(u.time.mul(2.4).add(n1.mul(18.0))).mul(0.25).add(0.75);
            const fire = mix(u.auroraLow, u.moonCol, 0.35).mul(cracks).mul(open).mul(throb)
                .mul(u.veins.mul(4.2));
            col.addAssign(fire);
            // The ground beside an open vein is lit by it.
            col.addAssign(body.mul(u.auroraLow).mul(luBell(n1.sub(0.5).mul(7.0))).mul(open).mul(u.veins)
                .mul(0.7));
        }

        // The air in front of the moon: its dark side is the colour of the sky, never black.
        const dir = toCam.negate();
        return col.mul(u.breath.mul(0.75).add(0.25)).add(luSkyBase(u, dir).mul(0.7));
    })();

    const geometry = new THREE.SphereGeometry(1, companion ? 48 : 96, companion ? 24 : 48);
    const part = luPart(material.name, geometry, material, companion ? -22 : -21);
    part.uniforms = uniforms;
    /** Put the moon at a world position with a radius (the mesh and the shader agree on both). */
    part.place = (x, y, z, radius) => {
        uniforms.place.value.set(x, y, z, radius);
        part.mesh.position.set(x, y, z);
        part.mesh.scale.setScalar(radius);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}
