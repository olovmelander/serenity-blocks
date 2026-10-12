/**
 * Thermal Bloom — the basin: the Iris, its living bands and fingers, and the pale sinter apron out
 * to the far rim, on one polar fan mesh centred on the Iris.
 *
 * The ground's colour is a function of the water's TEMPERATURE, T (1 at the vent … 0 on dry
 * sinter), computed per fragment exactly as the Stage A0 CPU lab proved it (iris-springs.md
 * §5.12; parameters below): an elliptic distance to an off-centre vent, domain-warped by baked
 * fBm, scalloped into lobes that differ from band to band and stretched downhill (toward the
 * camera, where the runoff fans out); 26 braided, branching, tapering FINGERS in (θ·N, log r)
 * where hot water runs further (longest downhill; some channels dry; they never lift the mats
 * into water); patches that break the bands up (crisp near the rim, diffuse in the cooler bands);
 * and a fine micro-texture perturbing the lookup. T reads the season's row of the ramp texture;
 * a succession front picks the old or the new row per pixel as it sweeps out from the Iris.
 *
 * Inside the pool, the water: an analytic bowl that drops toward the vent with white sinter
 * ledges seen through it, wavering under convection (a fake refraction of the ledge pattern);
 * Beer-law colour from milky cyan over the shallow shelf through turquoise to cobalt in the
 * throat; boil domes that swell and relax in the eye on a hashed clock; a sky sheen at grazing
 * angles clamped at 0.12, so the cobalt never washes out. Not a mirror.
 *
 * Outside it: the mats' microterrace crackle (a cellular network, elongated across the flow),
 * wet fingers (darker, more saturated, glossy), bright sinter flats against damp grey sinter on
 * the dry apron; light from the three-quarter back-side sun (wrap-Lambert on a bump normal from
 * the fingers' incisions and the crackle's ridges) and the sky; aerial perspective toward a
 * warm pearl. Every fine term fades by the pixel's footprint, so nothing shimmers.
 *
 * Lab parameters that passed A0 (v4): vent 0.13 R uphill, warp 0.22 (period ~55 m), lobes 0.32
 * (two angular frequencies), band radii (R) eye 0.55 / shelf 0.90 / rim 1.0 / lemon 1.05 /
 * orange 1.20 / rust 1.55 / olive 2.3 / dry 3.4 (tightened in A1 so the fingers cross a brown field), downhill stretch 0.45, 26 fingers of length
 * 2.2 R, breakup 0.025 + 0.07·cool, micro 0.05.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    clamp,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    sign,
    smoothstep,
    sqrt,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    IRIS_RADIUS,
    SEASONS,
    tbAerial,
    tbHash21,
    tbHgMix,
    tbLuma,
    tbPart,
    tbSchlick,
} from './thermal-bloom-tsl.js';
import { bakeBasinFan } from './thermal-bloom-bake.js';

/** The fan's reach (metres from the Iris): the far rim forest stands on its edge. */
export const BASIN_EXTENT = 3600;

const TAU = Math.PI * 2;
/** The A0 lab's parameters (see the header). */
const LAB = Object.freeze({
    vent: 0.13,
    warp: 0.22,
    lobe: 0.32,
    stretch: 0.45,
    fingers: 26,
    fingerLen: 2.2,
    micro: 0.05,
});
/** The temperature profile along the (warped, lobed) radius, in pool radii → T. */
const PROFILE = Object.freeze([
    [0, 1.0], [0.55, 0.92], [0.9, 0.86], [1.0, 0.8], [1.05, 0.72], [1.2, 0.58],
    [1.55, 0.44], [2.3, 0.27], [3.4, 0.12], [9.0, 0.0],
]);
/** Metres per tile of the noise atlas's low channel (4 cells a tile, ~55 m a cell). */
const NOISE_TILE = 220;

/** T for a radius: the piecewise-linear profile as a sum of clamped ramps (no branches). */
function profileT(rs) {
    let T = float(PROFILE[0][1]);
    for (let i = 1; i < PROFILE.length; i++) {
        const [r0, t0] = PROFILE[i - 1];
        const [r1, t1] = PROFILE[i];
        T = T.add(clamp(rs.sub(r0).div(r1 - r0), 0.0, 1.0).mul(t1 - t0));
    }
    return T;
}

/** The ramp's colour at T on a season row (linear rgb; stored as √linear). */
function rampColor(tex, T, row) {
    const st = vec2(clamp(T, 0.0, 1.0).mul(255 / 256).add(0.5 / 256), row.add(0.5).div(SEASONS.length));
    const c = texture(tex.ramp, st).level(0).rgb;
    return c.mul(c);
}

/**
 * The basin part.
 * @param {object} u     the shared uniforms
 * @param {object} tier  the quality tier
 * @param {object} tex   the world's baked textures (noise, cellular, ramp)
 */
export function createBasin(u, tier, tex) {
    const [rings, spokes] = tier.fan;
    const fan = bakeBasinFan(rings, spokes, { extent: BASIN_EXTENT, poolRadius: IRIS_RADIUS });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));
    const microOctaves = tier.matOctaves;

    const noise = (uv) => texture(tex.noise, uv);

    const basinFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P).toVar();
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        // Metres a pixel covers here (grazing angles stretch it): fine terms fade by it.
        const foot = dist.mul(u.pixelAngle).div(max(V.y, 0.12)).toVar();
        const fade = (size) => float(1.0).sub(smoothstep(size * 0.3, size, foot));

        // ── The temperature field ──
        const R = u.irisRadius;
        const rel = P.xz.sub(u.irisCentre).div(R).toVar();
        const warp = noise(P.xz.div(NOISE_TILE)).toVar();
        const wrel = rel.add(vec2(warp.x.sub(0.5), warp.y.sub(0.5)).mul(LAB.warp));
        const down = u.downhill;
        const across = vec2(down.y.negate(), down.x);
        const r0 = length(rel);
        // The vent sits uphill of the pool's centre: measured from it, the bowl is off-centre.
        const q = vec2(dot(wrel, across), dot(wrel, down).add(clamp(float(1.0).sub(r0), 0.0, 1.0).mul(LAB.vent)))
            .toVar();
        const r = max(length(q), 1e-4).toVar();
        // θ = 0 downhill; the seam at ±π faces uphill, behind the pool.
        const th = atan(q.x, q.y).toVar();
        const cth = q.y.div(r);
        const sth = q.x.div(r);
        const lobe = noise(vec2(cth.mul(1.4).add(r.mul(0.7)).add(4.0), sth.mul(1.4).sub(r.mul(0.5))).div(4.0))
            .x.sub(0.5).mul(2.0);
        const lobe2 = noise(vec2(cth.mul(3.1).sub(r.mul(1.3)).add(9.0), sth.mul(3.1).add(r.mul(1.1))).div(8.0))
            .y.sub(0.5).mul(2.0);
        const outside = clamp(r.sub(0.98), 0.0, 2.0);
        const rr = r.add(outside.mul(lobe.mul(LAB.lobe).add(lobe2.mul(LAB.lobe * 0.5))))
            .add(lobe2.mul(0.06).mul(clamp(r, 0.0, 1.0))).toVar();
        const downness = clamp(cth.add(0.2).div(1.2), 0.0, 1.0).toVar();
        const stretch = float(1.0).add(downness.mul(LAB.stretch).mul(clamp(rr.sub(1.0), 0.0, 3.0)));
        const rsRaw = rr.sub(step(1.0, rr).mul(rr.sub(1.0)).mul(float(1.0).sub(float(1.0).div(stretch))));
        // The combo's heat widens the eye and marches the bands outward.
        const rs = rsRaw.div(float(1.0).add(u.heat)).toVar();
        const T = profileT(rs).toVar();

        // Fingers: braided, branching, tapering; longest downhill; some channels dry.
        const lr = log(max(r, 0.05));
        const thw = th.add(noise(vec2(cth.mul(2.3).add(1.7), sth.mul(2.3).sub(4.1)).div(4.0)).x.sub(0.5).mul(0.55));
        const fa = thw.mul(LAB.fingers / TAU)
            .add(texture(tex.noise, vec2(lr.mul(2.6).add(1.3), thw.mul(1.3)).div(4.0)).level(1.0).x.sub(0.5).mul(1.6))
            .toVar();
        const cell = floor(fa);
        const tri = float(1.0).sub(abs(fract(fa).mul(2.0).sub(1.0)));
        const width = float(0.55).add(tbHash21(vec2(cell, 3.3)).mul(0.45)).mul(0.55);
        const ridgeA = clamp(tri.sub(float(1.0).sub(width)).div(width), 0.0, 1.0);
        const fb = th.mul((LAB.fingers * 1.9) / TAU)
            .add(texture(tex.noise, vec2(lr.mul(3.1).sub(2.0), th.mul(2.1)).div(4.0)).level(1.0).x.sub(0.5).mul(2.2));
        const tri2 = float(1.0).sub(abs(fract(fb).mul(2.0).sub(1.0)));
        const ridgeB = clamp(tri2.sub(0.8).div(0.2), 0.0, 1.0);
        const branchOn = smoothstep(0.3, 0.9, noise(vec2(fb.mul(0.5), lr.mul(2.0).add(5.0)).div(4.0)).y);
        const ridge = max(ridgeA.mul(sqrt(ridgeA)), ridgeB.mul(sqrt(ridgeB)).mul(branchOn).mul(0.85));
        const strength = smoothstep(0.12, 0.5, tbHash21(vec2(cell, 7.7)));
        const reach = float(LAB.fingerLen).mul(tbHash21(vec2(cell, 9.1)).add(0.45)).mul(downness.add(0.25))
            .mul(u.reach);
        const alongF = clamp(rs.sub(1.0).div(max(reach, 1e-3)), 0.0, 1.0);
        const onMats = step(1.02, rs).toVar();
        const finger = ridge.mul(strength).mul(float(1.0).sub(alongF)).mul(onMats).toVar();
        const lifted = min(T.add(finger.mul(0.32).mul(float(1.0).sub(smoothstep(0.55, 1.0, alongF)))), max(T, 0.72));
        T.assign(mix(T, lifted, onMats));

        // Band breakup (crisp near the rim, diffuse in the cooler bands) and micro-texture.
        const patch = noise(P.xz.mul(0.06 / 4)).x.sub(0.5).mul(2.0);
        const cool = clamp(float(0.78).sub(T).div(0.5), 0.0, 1.0);
        T.addAssign(onMats.mul(patch).mul(cool.mul(0.07).add(0.025)));
        let micro = noise(P.xz.mul(0.45 / 16)).z.sub(0.5);
        if (microOctaves > 1) micro = micro.add(noise(P.xz.mul(1.3 / 16)).z.sub(0.5).mul(0.5));
        if (microOctaves > 2) micro = micro.add(noise(P.xz.mul(3.7 / 16)).z.sub(0.5).mul(0.25));
        T.addAssign(micro.mul(LAB.micro * 2).mul(onMats).mul(fade(2.5)));

        // ── Albedo: the season's ramp, swept by the succession front ──
        const metres = rs.mul(R);
        const frontEdge = u.frontRadius.add(noise(P.xz.div(90.0)).y.sub(0.5).mul(60.0)).add(finger.mul(40.0));
        const swept = float(1.0).sub(smoothstep(frontEdge.sub(12.0), frontEdge.add(12.0), metres));
        const albedo = mix(rampColor(tex, T, u.seasonFrom), rampColor(tex, T, u.seasonTo), swept).toVar();

        // Microterrace crackle: thin ridges of a cellular network, elongated across the flow.
        const cellUv = vec2(dot(P.xz, across).mul(0.33), dot(P.xz, down).mul(0.55)).div(12.0);
        const crackTex = texture(tex.cellular, cellUv).toVar();
        const crack = float(1.0).sub(smoothstep(0.0, 0.21, crackTex.x)).mul(fade(3.0)).toVar();
        albedo.mulAssign(float(1.0).sub(crack.mul(0.22).mul(onMats)));
        // Dry sinter: bright flats against damp grey sinter (snow covers both in Deep Cold).
        const flats = smoothstep(0.36, 0.68, noise(P.xz.mul(0.016 / 4)).x);
        const dry = clamp(float(0.2).sub(T).div(0.2), 0.0, 1.0).mul(float(1.0).sub(u.snow));
        albedo.assign(mix(albedo, mix(vec3(0.5, 0.5, 0.47), vec3(0.86, 0.83, 0.77), flats), dry));
        // Wet fingers: darker and more saturated, as wet rock is.
        const wet = clamp(finger.mul(1.5), 0.0, 1.0).mul(onMats).toVar();
        const luma = tbLuma(albedo);
        albedo.assign(albedo.mul(float(1.0).sub(wet.mul(0.18))).add(albedo.sub(luma).mul(wet.mul(0.25))));

        // ── Light ──
        // A bump normal from the fingers' incisions and the crackle's ridges (screen derivatives).
        const bump = finger.mul(-0.35).add(crack.mul(0.06)).mul(onMats).toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const N0 = vec3(0.0, 1.0, 0.0);
        const r1 = cross(dpdy, N0);
        const r2 = cross(N0, dpdx);
        const det = dot(dpdx, r1);
        const grad = sign(det).mul(dFdx(bump)).mul(r1).add(sign(det).mul(dFdy(bump)).mul(r2));
        const N = normalize(abs(det).mul(N0).sub(grad)).toVar();
        const ndl = dot(N, u.sunDir);
        const wrapLit = clamp(ndl.add(0.25).div(1.25), 0.0, 1.0);
        const skyAmb = mix(u.haze, u.zenith, 0.6).mul(N.y.mul(0.25).add(0.25));
        const ground = albedo.mul(u.sunColor.mul(wrapLit.mul(1.3)).add(skyAmb)).toVar();
        // Wet facets catch the sky (Schlick, as products).
        const fresWet = tbSchlick(max(dot(N, V), 0.0), float(0.03)).mul(wet).mul(0.6);
        ground.addAssign(mix(u.haze, u.zenith, 0.5).mul(fresWet));

        // ── The water ──
        const pool = float(1.0).sub(smoothstep(0.975, 0.995, rs)).toVar();
        const vd = length(vec2(q.x, q.y.add(LAB.vent * 0.6).mul(1.15)));
        const bowl = clamp(float(1.0).sub(rs.mul(rs).max(1e-4).pow(0.8)), 0.0, 1.0)
            .mul(clamp(float(1.25).sub(vd), 0.0, 1.25).div(1.25)).toVar();
        // Convection: the ledges waver (a fake refraction), big ripples 0.3 Hz, fine 1.5 Hz.
        const t = u.time;
        const wob = noise(P.xz.div(34.0).add(vec2(t.mul(0.011), t.mul(-0.007)))).y.sub(0.5)
            .add(noise(P.xz.div(9.0).add(vec2(t.mul(-0.05), t.mul(0.04)))).z.sub(0.5).mul(0.5));
        const ledges = floor(bowl.mul(7.0).add(wob.mul(0.5)).add(warp.z.mul(0.35))).div(7.0);
        // Boil domes: one every few seconds on a hashed clock, swelling and relaxing in the eye.
        const boilCell = floor(t.div(6.5));
        const boilAge = t.sub(boilCell.mul(6.5));
        const boilAt = vec2(tbHash21(vec2(boilCell, 1.3)).sub(0.5), tbHash21(vec2(boilCell, 2.9)).sub(0.5)).mul(0.5);
        const boilR = length(vec2(q.x, q.y.add(LAB.vent)).sub(boilAt)).div(0.14);
        const boil = exp(boilR.mul(boilR).negate()).mul(smoothstep(0.0, 1.2, boilAge))
            .mul(float(1.0).sub(smoothstep(2.5, 5.5, boilAge)));
        const depth = bowl.mul(0.55).add(ledges.mul(0.45)).mul(55.0).sub(boil.mul(6.0))
            .max(0.0)
            .toVar();
        const kShelf = float(1.0).sub(exp(depth.div(-4.0)));
        const kDeep = smoothstep(18.0, 48.0, depth).mul(0.8);
        const shallow = vec3(0.6, 0.86, 0.79);
        const turq = vec3(0.016, 0.5, 0.6);
        const deep = vec3(0.007, 0.1, 0.4);
        const waterAlb = mix(mix(shallow, turq, kShelf), deep, kDeep).add(vec3(0.0, 0.08, 0.07).mul(boil)).toVar();
        const waterLit = waterAlb.mul(u.sunColor.mul(max(u.sunDir.y, 0.0).mul(1.6).add(0.15)).add(u.zenith.mul(0.35)));
        const fres = min(tbSchlick(max(V.y, 0.0), float(0.02)), 0.12);
        const water = mix(waterLit, mix(u.haze, u.zenith, 0.55).mul(1.1), fres);

        const col = mix(ground, water, pool).toVar();
        // A faint lift where the sun's forward scatter meets the wet rim (never a glare).
        col.addAssign(u.sunColor.mul(tbHgMix(dot(V.negate(), u.sunDir), float(0.7)).mul(0.02)));
        // Aerial perspective toward the warm pearl.
        const outCol = tbAerial(u, col, dist, V.negate());
        return vec4(max(outCol, vec3(0.0)), 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomBasin';
    material.fog = false;
    material.colorNode = basinFn();
    const part = tbPart('ThermalBloomBasin', geometry, material, 10);
    /** Stand the fan on the Iris's centre (world metres). */
    part.place = (x, z) => {
        part.mesh.position.set(x, 0, z);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}

/** The profile's breakpoints (pool radii → T), for the tests. */
export const BASIN_PROFILE = PROFILE;
