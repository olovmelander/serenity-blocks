/**
 * Lunara — the twin moons.
 *
 * The great moon and its rose companion are spheres on a far shell that follows the camera; the
 * companion circles the great moon, passing in front of it and behind. Both are lit by the same
 * unseen sun, so they show the same phase, with terraced impact relief on the great moon,
 * iron plains on the companion, earthshine on the dark side and a thin rim of
 * lit atmosphere.
 *
 * The great moon answers the board: as a chain of clears builds, veins of light open across its
 * face from the centre outward, and a four-line clear fires them all.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    cameraPosition,
    cross,
    dFdx,
    dFdy,
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
    luBell, luPart, luSkyGradient,
} from './lunara-tsl.js';

/** Distance of the shell the moons hang on (inside the sky dome, beyond every mountain). */
export const MOON_DISTANCE = 5200;

/** The same surface sample lights the sphere and its reflection on the lean tiers. */
export function lunarSurface(u, N, ndv, packed, fade, companion, relief) {
    const own = companion ? u.companionCol : u.moonCol;
    const elevation = mix(float(0.5), companion ? packed.a : packed.r, fade).toVar();
    const sun = dot(N, u.sunDir).toVar();
    let diffuse = sun;
    if (relief && !companion) {
        const eastAxis = cross(vec3(0, 1, 0), N);
        const east = eastAxis.div(max(eastAxis.length(), 0.001));
        const slope = packed.gb.sub(0.5).mul(fade).mul(1.65);
        const reliefNormal = normalize(N.sub(east.mul(slope.x)).sub(cross(N, east).mul(slope.y)));
        diffuse = dot(reliefNormal, u.sunDir);
    }
    const daylight = smoothstep(-0.10, 0.18, sun).mul(max(diffuse, 0).mul(0.82).add(0.18));
    let ground;
    if (companion) {
        // Cold skylight colours the limb while iron oxide keeps the plains red in every phase.
        const cool = max(own.g, own.b);
        const oxide = vec3(1.0, 0.18, 0.14).mul(max(own.r, cool));
        const soil = mix(own.mul(vec3(1.0, 0.49, 0.38)), oxide, clamp(cool.sub(own.r).mul(1.25), 0, 1));
        const plain = mix(vec3(0.13, 0.023, 0.036), soil, smoothstep(0.15, 0.62, elevation));
        ground = mix(plain, vec3(1.0, 0.45, 0.27), smoothstep(0.55, 0.92, elevation).mul(0.75));
    } else {
        const basalt = own.mul(vec3(0.29, 0.28, 0.40));
        const feldspar = mix(own, vec3(1.0, 0.90, 0.84), 0.52);
        ground = mix(basalt, feldspar, smoothstep(0.25, 0.72, elevation)).mul(elevation.mul(0.95).add(0.35));
    }
    const limb = float(1).sub(ndv).toVar();
    const earthshine = mix(vec3(0.065, 0.074, 0.15), own.mul(0.1), 0.25);
    const col = ground.mul(daylight.mul(companion ? 1.3 : 1.16).add(earthshine)).toVar();
    const air = pow(limb, companion ? 3.8 : 5.5).mul(smoothstep(-0.46, 0.42, sun));
    col.addAssign(mix(own, companion ? vec3(1.0, 0.32, 0.18) : vec3(0.71, 0.8, 1.0), 0.55).mul(air).mul(0.62));
    return col;
}

/**
 * @param {object} u       shared valley uniforms
 * @param {object} map     packed albedo, tangent slopes and companion terrain
 * @param {object} mapFade uniform 0..1: how much of the map has faded in
 * @param {object} opts
 * @param {boolean} opts.companion  the rose moon: no veins, its own colour and face
 * @param {boolean} [opts.relief=true]  apply the baked tangent slopes
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
        const ndv = clamp(dot(N, toCam), 0.0, 1.0).toVar();
        const st = vec2(uv().x.add(uniforms.turn).fract(), uv().y).toVar();
        // Keep the mip footprint continuous where the rotating longitude wraps from one to zero.
        const packed = map.sample(st).grad(dFdx(uv()), dFdy(uv())).toVar();
        const col = lunarSurface(u, N, ndv, packed, mapFade, companion, relief);

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
            col.addAssign(u.moonCol.mul(u.auroraLow).mul(luBell(n1.sub(0.5).mul(7.0))).mul(open).mul(u.veins)
                .mul(0.28));
        }

        // The air in front of the moon: a little of the sky's colour, so the night side stands
        // darker than the sky round it (it hides the glow behind it) but never black.
        const dir = toCam.negate();
        return col.mul(u.breath.mul(0.75).add(0.25)).add(luSkyGradient(u, dir).mul(0.6));
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
