/**
 * Himalayan Peak — the massif.
 *
 * One mesh of what the eye can see of the baked amphitheatre (himalayan-peak-field.js cuts it),
 * shaded per pixel from the field's textures: the big forms come from the baked normal, the
 * small ones are drawn on — striations pulled down the fall line of every steep face, strata
 * banded across the rock, snow lying where the ground is gentle or hollow and scoured off the
 * ribs. The sun is one direction and one lookup: the horizon map says whether the rest of the
 * mountain stands in its way, for whatever elevation the chain has raised it to.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    dot,
    float,
    fwidth,
    max,
    mix,
    normalize,
    positionLocal,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { buildMassifMesh } from './himalayan-peak-field.js';
import {
    hpAtmosphere, hpGroundLight, hpPart, hpPow4, hpSolidMaterial, hpSq, hpWaveLight,
} from './himalayan-peak-tsl.js';

/** Rock, from the darkest slate to the pale band high on the hero (scene-linear). */
const ROCK_DARK = [0.062, 0.054, 0.058];
const ROCK_BROWN = [0.15, 0.115, 0.095];
const ROCK_PALE = [0.27, 0.235, 0.2];
const ROCK_OCHRE = [0.36, 0.24, 0.11];
const SNOW = [0.84, 0.88, 0.95];
const ICE = [0.42, 0.62, 0.8];

/**
 * @param {object} u       shared uniforms
 * @param {object} field   the derived field (heights, size)
 * @param {object} options
 * @param {number} options.stride  grid cells per mesh cell
 * @param {number} options.air     shadow samples through the haze
 */
export function createMassif(u, field, { stride = 2, air = 4 } = {}) {
    // load() cuts the mesh ahead of the build, between frames; a world built without it cuts it here.
    const built = field.mesh?.stride === stride ? field.mesh : buildMassifMesh(field.heights, field.size, { stride });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));

    const material = hpSolidMaterial('HimalayanPeakMassif');
    material.colorNode = Fn(() => {
        const P = positionLocal;
        const flat = u.fieldUv(P.xz);
        // The field is read a fraction of a cell off its grid, bent by noise: the cells never show.
        const bend = u.noise(P.xz.mul(1 / 190).add(0.63));
        const st = flat.add(vec2(bend.x, bend.w).sub(0.5).mul(1.6 / field.size));
        const S = texture(u.shadeTex, st);
        const nxz = S.rg.mul(2.0).sub(1.0);
        const ny = sqrt(max(float(1.0).sub(dot(nxz, nxz)), 0.02));
        const N0 = vec3(nxz.x, ny, nxz.y);
        const open = S.b;
        const hollow = S.a.sub(0.5);
        const slope = float(1.0).sub(ny);
        const steep = smoothstep(0.16, 0.5, slope);

        // ── Drawn detail ──
        // Striations down the fall line: the noise is stretched tall and read on whichever
        // upright plane the face is nearer to.
        const tall = P.y.mul(0.13);
        const along = abs(N0.x).div(abs(N0.x).add(abs(N0.z)).add(1e-3));
        const sA = u.noise(vec2(P.x, tall).mul(1 / 210));
        const sB = u.noise(vec2(P.z, tall).mul(1 / 210));
        const stria = mix(sA, sB, along).toVar();
        const fA = u.noise(vec2(P.x, tall).mul(1 / 57).add(0.37));
        const fB = u.noise(vec2(P.z, tall).mul(1 / 57).add(0.37));
        const flute = mix(fA, fB, along).toVar();
        const grain = u.noise(P.xz.mul(1 / 61)).toVar();
        const rib = stria.x.mul(0.65).add(flute.x.mul(0.35));
        // The striations lean the surface across the face (their gradient along the horizontal).
        const lean = stria.y.mul(0.9).add(flute.y.mul(0.75)).mul(steep);
        const N = normalize(vec3(
            N0.x.sub(lean.mul(float(1.0).sub(along))).sub(grain.y.mul(0.22)),
            N0.y,
            N0.z.sub(lean.mul(along)).sub(grain.z.mul(0.22)),
        )).toVar();

        // ── Snow and rock ──
        const lee = N0.x.mul(0.5).add(0.5);
        const cover = float(0.66).sub(slope.mul(1.18))
            .add(hollow.mul(2.6))
            .add(rib.sub(0.5).mul(0.3).mul(steep).negate())
            .add(grain.w.sub(0.5).mul(0.3))
            .add(u.noise(P.xz.mul(1 / 1100)).w.sub(0.5).mul(0.5))
            .add(lee.mul(0.1))
            .add(smoothstep(900.0, 2600.0, P.y).mul(0.07));
        // (The snow line is never thinner than a pixel and a bit: a threshold has no other edge.)
        const blur = fwidth(cover).mul(1.3);
        const snow = smoothstep(float(-0.04).sub(blur), float(0.3).add(blur), cover).mul(smoothstep(-260.0, 120.0, P.y)).toVar();
        // Strata: bands across the rock, tilted, and bent by the grain.
        const bed = P.y.add(P.x.mul(0.21)).sub(P.z.mul(0.09)).add(grain.x.mul(120.0));
        const strata = u.noise(vec2(bed.mul(1 / 1900), 0.31));
        const rock = mix(vec3(...ROCK_DARK), vec3(...ROCK_BROWN), smoothstep(0.34, 0.6, strata.x)).toVar();
        rock.assign(mix(rock, vec3(...ROCK_PALE), smoothstep(0.56, 0.74, strata.w).mul(0.8)));
        // The pale band high on the walls.
        const band = smoothstep(2150.0, 2330.0, bed).mul(smoothstep(2760.0, 2560.0, bed));
        rock.assign(mix(rock, vec3(...ROCK_OCHRE), band.mul(smoothstep(0.35, 0.6, strata.w)).mul(0.85)));
        rock.mulAssign(rib.mul(0.5).add(0.72));
        // Rime and last night's dusting cling to the rock itself.
        rock.assign(mix(rock, vec3(...SNOW).mul(0.82), smoothstep(0.4, 0.8, grain.w).mul(0.26)));
        // Old ice shows blue where the snow hangs steep.
        const ice = smoothstep(0.34, 0.56, slope).mul(smoothstep(0.3, 0.7, flute.w)).mul(0.55);
        const white = mix(vec3(...SNOW), vec3(...ICE), ice);
        const albedo = mix(rock, white, snow);

        // ── Light ──
        const sun = hpGroundLight(u, st);
        const ndl = dot(N, u.sunDir);
        // Snow lets light into itself; rock does not.
        const soft = clamp(ndl.add(0.24).div(1.24), 0.0, 1.0);
        const diffuse = mix(clamp(ndl, 0.0, 1.0), soft, snow);
        // Raking light picks out every flute: the hollows between ribs lose it first.
        const raked = mix(float(1.0), smoothstep(0.0, 0.8, rib.add(ndl.mul(0.9))), steep.mul(0.6));
        const direct = u.sunCol.mul(diffuse.mul(sun).mul(raked));
        const openSky = open.mul(open);
        const facing = max(dot(normalize(N.xz.add(vec2(1e-4, 0.0))), u.sunFlat), 0.0);
        const ambient = u.shade.mul(N.y.mul(0.55).add(0.5)).mul(openSky)
            .add(u.glow.mul(facing.mul(0.07).mul(openSky)))
            // The cloud sea gives a little of its light back to whatever leans over it.
            .add(u.cloudCol.mul(float(1.0).sub(N.y).mul(0.07)).mul(smoothstep(1500.0, 100.0, P.y)));
        const eye = vec3(cameraPosition.x.div(u.squeeze), cameraPosition.y, cameraPosition.z);
        const V = normalize(eye.sub(P));
        const Hv = normalize(V.add(u.sunDir));
        const sheen = hpPow4(hpSq(clamp(dot(N, Hv), 0.0, 1.0))).mul(snow).mul(sun).mul(0.55);
        // A clear's light running down the mountain.
        // (It follows the ground: sooner down the gullies, later over the ribs.)
        const wave = hpWaveLight(u, P.y.add(grain.x.sub(0.5).mul(240.0)).sub(hollow.mul(380.0)));
        const answered = wave.rgb.mul(1.9).add(u.sunCol.mul(wave.a.mul(0.07))).mul(snow.mul(0.75).add(0.25));
        const lit = albedo.mul(direct.add(ambient).add(answered)).add(u.sunCol.mul(sheen));
        return vec4(hpAtmosphere(u, lit.mul(u.breath.mul(0.85).add(0.15)), P, { steps: air }), 1.0);
    })();

    const part = hpPart('HimalayanPeakMassif', geometry, material, 0);
    part.cells = built.kept;
    part.vertices = built.positions.length / 3;
    return part;
}
