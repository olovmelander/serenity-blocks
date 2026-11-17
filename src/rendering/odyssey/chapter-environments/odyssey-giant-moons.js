/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE GIANT'S MOONS (2026-11-17, the Odyssey masterpiece pass).
 *
 * Early space (orbs 37-41) was sparse: the ringed giant hung still beside the rail, a picture of
 * a planet. A giant with rings has shepherds: three small moons now circle it just outside the
 * rings, each at its own pace (Kepler: the inner laps the outer), so while the eye passes the
 * giant there is always something crossing: a moon sliding over the lit cloud tops with its
 * shadow running ahead of it across the bands, another going dark as it enters the giant's own
 * shadow, a third coming out from behind the rings. In place: the giant does not move, and the
 * moons never leave its neighbourhood (their orbits stay inside 3.6 giant radii, so on the eye's
 * side they stay beyond the Earth's backdrop sphere while the Earth is up; pinned by test).
 *
 * One instanced draw of three small spheres in the giant's own frame (+Y its pole, the rings in
 * XZ), lit by the giant's own light (`uLight`), each with its own tone. The moons' places are a
 * pure function of the clock (`giantMoonsAt`); the same uniform rows feed the giant's cloud tops,
 * which trace each moon's shadow (odyssey-ringed-giant.tsl.js).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    dot,
    float,
    instanceIndex,
    max,
    modelWorldMatrixInverse,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    smoothstep,
    sqrt,
    uniformArray,
    vec3,
    vec4,
} from 'three/tsl';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';
import { orbitEarthTransmittance } from '../composition/odyssey-orbit-earth.js';

/**
 * The moons: orbit radius and own radius (giant radii), seconds for one orbit of the innermost
 * (the others follow Kepler's third law), where each starts (turns), its orbit's tilt out of the
 * ring plane and the node it tilts about (radians), and its tone (scene-linear).
 */
export const GIANT_MOONS = Object.freeze({
    innerPeriod: 118,
    moons: Object.freeze([
        Object.freeze({
            orbit: 2.52, radius: 0.058, start: 0.08, tilt: 0.012, node: 0.4, tone: [0.74, 0.7, 0.64],
        }),
        Object.freeze({
            orbit: 2.86, radius: 0.094, start: 0.52, tilt: 0.03, node: 2.1, tone: [0.62, 0.42, 0.26],
        }),
        Object.freeze({
            orbit: 3.24, radius: 0.047, start: 0.83, tilt: 0.05, node: 4.4, tone: [0.36, 0.38, 0.44],
        }),
    ]),
});

/** The draw order: with the giant's body (after the stars, before its rings and the Earth). */
export const GIANT_MOON_DRAW_ORDER = -0.78;

/**
 * Where the moons are at `time` (seconds), in the giant's frame and in giant radii: for each,
 * [x, y, z, radius].
 * @param {number} time
 * @returns {number[][]}
 */
export function giantMoonsAt(time) {
    const t = Number.isFinite(time) ? time : 0;
    const inner = GIANT_MOONS.moons[0].orbit;
    return GIANT_MOONS.moons.map((m) => {
        const period = GIANT_MOONS.innerPeriod * ((m.orbit / inner) ** 1.5);
        const a = Math.PI * 2 * (m.start + (t / period));
        // A circle in the ring plane, tipped by `tilt` about the line through `node`.
        const x = Math.cos(a) * m.orbit;
        const z = Math.sin(a) * m.orbit;
        const across = (x * -Math.sin(m.node)) + (z * Math.cos(m.node));
        return [x, across * Math.sin(m.tilt), z, m.radius];
    });
}

/**
 * A moon's shadow on the giant's cloud tops, inside a Fn: how much of the light from `S` (unit,
 * the giant's frame) reaches the point `n` on the unit sphere past the moons in `rows`
 * (uniformArray of [x, y, z, radius]): 1 = all of it. A moon's shadow is small and soft-edged.
 */
export function giantMoonShade(rows, n, S) {
    let shade = float(1);
    for (let i = 0; i < GIANT_MOONS.moons.length; i += 1) {
        const row = rows.element(i);
        const to = row.xyz.sub(n);
        const along = dot(to, S);
        const off = sqrt(max(dot(to, to).sub(along.mul(along)), 0));
        // Only a moon on the light's side throws one; its edge softens with its distance.
        const soft = row.w.mul(along.mul(0.12).add(0.35));
        const dark = float(1).sub(smoothstep(row.w.sub(soft), row.w.add(soft), off)).mul(smoothstep(0.0, 0.3, along));
        shade = shade.mul(float(1).sub(dark.mul(0.82)));
    }
    return shade;
}

/**
 * Build the moons for a giant of `radius` (the group's own units).
 * @param {object} u the giant's shared uniforms: { uLight, uLightColor }
 * @param {number} radius
 * @returns {{ mesh: THREE.InstancedMesh, rows: *, update: (time: number) => void, dispose: () => void }}
 */
export function createGiantMoons(u, radius) {
    const rows = uniformArray(giantMoonsAt(0).map((r) => new THREE.Vector4(...r)));
    const tones = uniformArray(GIANT_MOONS.moons.map((m) => new THREE.Vector3(...m.tone)));
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-giant-moons';
    material.fog = false;
    const row = rows.element(instanceIndex);
    material.positionNode = positionGeometry.mul(row.w.mul(radius)).add(row.xyz.mul(radius));
    material.colorNode = Fn(() => {
        const n = normalize(positionGeometry).toVar();
        const centre = rows.element(instanceIndex).toVar();
        const S = normalize(modelWorldMatrixInverse.mul(vec4(u.uLight, 0.0)).xyz).toVar();
        const mu0 = dot(n, S).toVar();
        // The giant's own shadow: a moon behind the giant from the light goes dark as it enters.
        const along = dot(centre.xyz, S).toVar();
        const away = sqrt(max(dot(centre.xyz, centre.xyz).sub(along.mul(along)), 0));
        const eclipsed = float(1).sub(smoothstep(0.93, 1.06, away)).mul(smoothstep(0.0, 0.4, along.negate()));
        const sunlit = pow(max(mu0, 0.0), 0.85).mul(smoothstep(-0.04, 0.12, mu0)).mul(float(1).sub(eclipsed.mul(0.97)));
        // Craters and plains: two reads of the lattice on the moon's own sphere.
        const seed = float(instanceIndex).mul(7.3);
        const rough = latticeNoise3(n.mul(3.1).add(vec3(seed, 1.7, 4.2))).mul(0.6)
            .add(latticeNoise3(n.mul(9.4).add(vec3(2.9, seed, 8.8))).mul(0.4));
        const albedo = tones.element(instanceIndex).mul(rough.mul(0.7).add(0.62));
        // The giant's shine on the side that faces it (it fills a fifth of the moon's sky).
        const toGiant = normalize(centre.xyz.negate());
        const shine = max(dot(n, toGiant), 0.0).mul(0.05);
        const lit = u.uLightColor.mul(sunlit.mul(1.15)).add(vec3(1.0, 0.82, 0.6).mul(shine));
        return albedo.mul(lit).add(albedo.mul(vec3(0.012, 0.016, 0.03)));
    })().mul(orbitEarthTransmittance(normalize(positionWorld.sub(cameraPosition))));
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 28, 18), material, GIANT_MOONS.moons.length);
    mesh.name = 'hero-planet-moons';
    mesh.frustumCulled = false;
    mesh.renderOrder = GIANT_MOON_DRAW_ORDER;
    return {
        mesh,
        rows,
        update(time) {
            const at = giantMoonsAt(time);
            for (let i = 0; i < at.length; i += 1) rows.array[i].set(at[i][0], at[i][1], at[i][2], at[i][3]);
        },
        dispose() {
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
