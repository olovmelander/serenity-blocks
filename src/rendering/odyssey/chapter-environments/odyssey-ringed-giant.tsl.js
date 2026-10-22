/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 6's ringed giant — the materials (see odyssey-ringed-giant.js for the
 * data and why it exists).
 *
 * Three meshes in the giant's own frame (+Y = its pole, 1 unit of `radius` = one giant radius):
 *  - the cloud tops: the band table read along a latitude the cloud bends, two flow reads half a
 *    cycle apart so the jets' shear never winds up, a storm, the rings' shadow traced to the ring
 *    plane and read from the same profile the rings are drawn from, a terminator that reddens and
 *    a limb that darkens, haze on the day limb;
 *  - the rings: one annulus in the equator plane, a slab of ice with an optical depth (reflection
 *    on the lit face, light through on the unlit one, forward-scattering dust), the giant's shadow
 *    across them, alpha from the slab's depth along the view ray, so the far half hides behind the
 *    giant by the depth buffer and the near half veils it;
 *  - a thin atmosphere shell lit from its limb.
 *
 * Everything is built at chapter creation; at run time only uniforms move (ADR-0020). Lit by ONE
 * world-space light (`uLight`, a direction toward the source) so the terminator is a property of
 * the giant in the world, not of where the camera stands. Every fragment is bounded (no pow of a
 * negative, no division by a vanishing cosine): NaNs here would bloom into a black frame.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    asin,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    Fn,
    fwidth,
    If,
    length,
    log2,
    materialOpacity,
    max,
    mix,
    modelWorldMatrix,
    modelWorldMatrixInverse,
    normalize,
    oneMinus,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    bakeGiantBands,
    bakeGiantRingProfile,
    GIANT_PALETTE,
    GIANT_RING_TAU_MAX,
    GIANT_RINGS,
} from './odyssey-ringed-giant.js';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';
import { keepOdysseyTexture } from './shared/odyssey-resident-textures.js';

/** Seconds one flow read takes to run its half-cycle (two reads cross-fade, so shear never winds up). */
const FLOW_CYCLE = 140;
/** How far (radians of longitude) the fastest jet carries the cloud across one read. */
const FLOW_SPAN = 0.55;
/** The giant's spin, radians per second (a giant turns slowly; its jets carry the life). */
const SPIN_RATE = 0.0045;

let textures = null;

function bandTexture(data, width, srgb) {
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** The giant's tables as textures, built once and shared by every material that reads them. */
export function getRingedGiantTextures() {
    if (textures) return textures;
    const bands = bakeGiantBands();
    const ring = bakeGiantRingProfile();
    const ringTex = new THREE.DataTexture(ring.levels[0].data, ring.size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    ringTex.mipmaps = ring.levels.map((level) => ({ data: level.data, width: level.width, height: 1 }));
    ringTex.wrapS = THREE.ClampToEdgeWrapping;
    ringTex.wrapT = THREE.ClampToEdgeWrapping;
    ringTex.magFilter = THREE.LinearFilter;
    ringTex.minFilter = THREE.LinearMipmapLinearFilter;
    ringTex.generateMipmaps = false;
    ringTex.colorSpace = THREE.NoColorSpace;
    ringTex.needsUpdate = true;
    textures = {
        bandColor: keepOdysseyTexture(bandTexture(bands.colors, bands.size, true)),
        bandFar: keepOdysseyTexture(bandTexture(bands.far, bands.farSize, true)),
        bandMeta: keepOdysseyTexture(bandTexture(bands.meta, bands.size, false)),
        ring: keepOdysseyTexture(ringTex),
        ringSize: ring.size,
        bandSize: bands.size,
    };
    return textures;
}

const RING_SPAN = GIANT_RINGS.to - GIANT_RINGS.from;
const vec3Of = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

/**
 * The rings' profile at radius r (giant radii): (tau, ice, groove, dust).
 * @param {*} r float node
 * @param {*} lod float node (mip level)
 */
function ringProfileAt(tex, r, lod) {
    const p = texture(tex, vec2(r.sub(GIANT_RINGS.from).div(RING_SPAN), 0.5)).level(lod);
    return vec4(p.r.mul(p.r).mul(GIANT_RING_TAU_MAX), p.g, p.b, p.a);
}

/**
 * The cloud tops.
 * @param {object} u shared uniforms: { uTime, uLight, uLightColor, radius }
 */
function createSurface(u, radius, segments) {
    const T = getRingedGiantTextures();
    const P = GIANT_PALETTE;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-ringed-giant-surface';
    material.fog = false;
    material.colorNode = Fn(() => {
        // The giant's own frame: a unit sphere, +Y the pole. Directions in it are the world's
        // turned by the inverse model matrix (uniform scale, so normalise after).
        const n = normalize(positionLocal).toVar();
        const S = normalize(modelWorldMatrixInverse.mul(vec4(u.uLight, 0.0)).xyz).toVar();
        const V = normalize(modelWorldMatrixInverse.mul(vec4(cameraPosition.sub(positionWorld), 0.0)).xyz).toVar();
        const mu0 = dot(n, S).toVar();
        const mu = clamp(dot(n, V), 0.0, 1.0).toVar();

        const lat = asin(clamp(n.y, -1.0, 1.0)).toVar();
        const lon = atan(n.z, n.x).add(u.uTime.mul(SPIN_RATE)).toVar();
        const latN = lat.div(Math.PI).add(0.5).toVar();
        const meta = texture(T.bandMeta, vec2(latN, 0.5)).level(0).toVar();
        const wind = meta.g.mul(2.0).sub(1.0).toVar();
        const shear = meta.b.toVar();

        // The cloud, read on a cylinder about the pole (long in longitude, short in latitude, so
        // features run along the bands), carried by each band's own wind: two reads half a cycle
        // apart, cross-faded, so the shear never winds the pattern up.
        const flow = u.uTime.div(FLOW_CYCLE).fract();
        const nA = float(0.0).toVar();
        const nB = float(0.0).toVar();
        const nC = float(0.0).toVar();
        const norm = float(0.0).toVar();
        for (let k = 0; k < 2; k++) {
            const ph = flow.add(k * 0.5).fract();
            const w = oneMinus(abs(ph.mul(2.0).sub(1.0)));
            const Lk = lon.sub(wind.mul(ph.sub(0.5)).mul(FLOW_SPAN)).toVar();
            const ring = vec2(cos(Lk), sin(Lk));
            const a = latticeNoise3(vec3(ring.mul(2.2), lat.mul(7.0).add(k * 3.7))).sub(0.5).toVar();
            const b = latticeNoise3(vec3(ring.mul(6.5).add(a.mul(0.6)), lat.mul(21.0).add(a.mul(0.5)).add(k * 5.1)))
                .sub(0.5).toVar();
            const c = latticeNoise3(vec3(ring.mul(17.0).add(b.mul(0.5)), lat.mul(64.0).add(b.mul(0.3)).add(k * 9.3)))
                .sub(0.5);
            nA.addAssign(a.mul(w));
            nB.addAssign(b.mul(w));
            nC.addAssign(c.mul(w));
            norm.addAssign(w.mul(w));
        }
        // A cross-fade of two fields loses contrast half-way: give it back.
        const gain = float(1.0).div(sqrt(max(norm, 1e-3))).toVar();
        nA.mulAssign(gain);
        nB.mulAssign(gain);
        nC.mulAssign(gain);

        // Bent latitude -> the band's colour. Where a band is thinner than a pixel (the limb, the
        // poles) the blurred table takes over, so the edge does not shimmer.
        const bend = nA.mul(0.09).add(nB.mul(0.06)).mul(shear.add(0.25)).add(nC.mul(0.022).mul(shear));
        const latB = clamp(lat.add(bend).div(Math.PI).add(0.5), 0.003, 0.997).toVar();
        const thin = smoothstep(0.7, 2.2, fwidth(latB).mul(T.bandSize));
        const band = mix(
            texture(T.bandColor, vec2(latB, 0.5)).level(0),
            texture(T.bandFar, vec2(latB, 0.5)).level(0),
            thin,
        ).toVar();
        const mottle = nB.mul(0.7).add(nC.mul(0.8)).toVar();
        const albedo = band.rgb.mul(float(1.0).add(mottle.mul(band.a.mul(0.6).add(0.5)))).toVar();
        // High white cloud in the zones, torn by the fine field.
        const wisp = smoothstep(0.1, 0.42, nC.add(nB.mul(0.6))).mul(oneMinus(band.a)).mul(0.22);
        albedo.assign(mix(albedo, band.rgb.mul(1.22).add(0.04), wisp));

        // The storm: one long-lived oval in the southern belt, riding with the spin.
        const sLat = lat.add(0.38).div(0.075);
        // Longitude difference wrapped to (-pi, pi], so the oval never tears at the seam.
        const dLon = atan(sin(lon.sub(2.1)), cos(lon.sub(2.1))).div(0.16);
        const sR2 = sLat.mul(sLat).add(dLon.mul(dLon)).toVar();
        const storm = exp(sR2.negate()).toVar();
        const edge = sqrt(sR2).sub(1.25);
        const collar = exp(edge.mul(edge).mul(-6.0)).mul(0.35);
        albedo.assign(mix(albedo, vec3Of(P.storm).mul(mottle.mul(0.5).add(0.95)), storm.mul(0.78)));
        albedo.mulAssign(oneMinus(collar.mul(0.3)));

        // The rings' shadow on the cloud tops: from this point toward the light, to the ring
        // plane, read through the same profile the rings are drawn from.
        const ringShade = float(1.0).toVar();
        const sY = S.y;
        const ts = n.y.negate().div(max(abs(sY), 0.03).mul(step(0.0, sY).mul(2.0).sub(1.0))).toVar();
        If(ts.greaterThan(0.0).and(mu0.greaterThan(-0.12)), () => {
            const sh = n.add(S.mul(ts));
            const rs = length(vec2(sh.x, sh.z)).toVar();
            const prof = ringProfileAt(T.ring, rs, float(3.0));
            const inside = step(GIANT_RINGS.from, rs).mul(step(rs, GIANT_RINGS.to));
            ringShade.assign(mix(float(1.0), exp(prof.x.div(max(abs(sY), 0.05)).negate()), inside));
        });

        // Light: a soft terminator that reddens, a limb that darkens.
        const day = smoothstep(-0.1, 0.2, mu0).toVar();
        const diffuse = pow(max(mu0, 0.0), 0.78).mul(mix(float(1.0), pow(max(mu, 1e-3), 0.42), 0.72));
        const dusk = mix(vec3(1.0, 0.55, 0.32), vec3(1.0), smoothstep(0.0, 0.3, mu0));
        const lit = u.uLightColor.mul(dusk).mul(diffuse.mul(day).mul(1.12)).mul(ringShade.mul(0.94).add(0.06));
        // The night side keeps the sky's light and the rings' shine on the hemisphere facing their lit face.
        const dark = oneMinus(day);
        const ringshine = max(n.y.mul(step(0.0, sY).mul(2.0).sub(1.0)).add(0.25), 0.0).mul(0.03);
        const night = vec3Of(P.night).mul(0.05).add(vec3Of(P.ringIce).mul(u.uLightColor).mul(ringshine))
            .mul(dark.mul(0.8).add(0.2));
        const surface = albedo.mul(lit.add(night)).toVar();

        // The air: a veil toward the limb on the day side; a thin glow keeps the night limb apart from the sky.
        const rim = oneMinus(mu);
        const rim2 = rim.mul(rim);
        surface.assign(mix(surface, vec3Of(P.haze).mul(u.uLightColor).mul(day).mul(0.42), rim2.mul(rim2).mul(0.5)));
        surface.addAssign(vec3Of(P.night).mul(rim2.mul(rim2)).mul(dark).mul(0.5));
        return surface;
    })();
    const geometry = new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.6));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hero-planet-surface';
    mesh.renderOrder = 1;
    return { mesh, material, geometry };
}

/** The rings: one annulus in the giant's equator plane. */
function createRings(u, radius) {
    const T = getRingedGiantTextures();
    const P = GIANT_PALETTE;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-ringed-giant-rings';
    material.fog = false;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    const ringTexel = RING_SPAN / T.ringSize;
    const out = Fn(() => {
        const h = positionLocal.div(radius).toVar();
        const rr = length(vec2(h.x, h.z)).toVar();
        const S = normalize(modelWorldMatrixInverse.mul(vec4(u.uLight, 0.0)).xyz).toVar();
        const V = normalize(modelWorldMatrixInverse.mul(vec4(cameraPosition.sub(positionWorld), 0.0)).xyz).toVar();
        const muV = max(abs(V.y), 0.02).toVar();
        const mu0 = max(abs(S.y), 0.04).toVar();
        // A pixel's footprint across the rings, in texels of the profile.
        const lod = clamp(log2(max(fwidth(rr).div(ringTexel).mul(0.7), 1.0)), 0.0, 9.0);
        const prof = ringProfileAt(T.ring, rr, lod).toVar();
        const tau = prof.x.toVar();
        // Same face as the light: light scattered back by a slab of ice. Opposite face: light
        // that came through, mostly what the dust throws forward.
        const litFace = step(0.0, S.y.mul(V.y));
        const refl = oneMinus(exp(tau.mul(float(1.0).div(mu0).add(float(1.0).div(muV))).negate()))
            .mul(mu0.div(mu0.add(muV)));
        const through = oneMinus(exp(tau.div(muV).negate())).mul(exp(tau.div(mu0).negate()))
            .mul(prof.w.mul(0.8).add(0.2));
        const cosA = dot(S, V.negate());
        const forward = pow(clamp(cosA.mul(0.5).add(0.5), 0.0, 1.0), 6.0).mul(1.6);
        const back = pow(clamp(cosA.negate().mul(0.5).add(0.5), 0.0, 1.0), 2.5).mul(0.85).add(0.5);
        const scatter = mix(through.mul(forward.add(0.3)), refl.mul(mix(back, forward.add(0.25), prof.w)), litFace);
        // The giant's shadow across the rings (and the last light through its air along the edge).
        const along = dot(h, S).negate().toVar();
        const away = sqrt(max(dot(h, h).sub(along.mul(along)), 0.0)).toVar();
        const pen = along.mul(0.012).add(0.008);
        const shade = mix(float(1.0), smoothstep(oneMinus(pen), pen.add(1.0), away), step(0.0, along));
        const ice = mix(vec3Of(P.ringDust), vec3Of(P.ringIce), prof.y).mul(prof.z.mul(0.66).add(0.48));
        const lit = u.uLightColor.mul(scatter).mul(shade).mul(1.55);
        const dim = vec3Of(P.night).mul(0.05).mul(oneMinus(exp(tau.mul(-2.0))));
        const color = ice.mul(lit.add(dim));
        const alpha = oneMinus(exp(tau.div(muV).negate()))
            .mul(smoothstep(GIANT_RINGS.from, GIANT_RINGS.from + 0.01, rr))
            .mul(oneMinus(smoothstep(GIANT_RINGS.to - 0.02, GIANT_RINGS.to, rr)));
        return vec4(color, alpha);
    })();
    material.colorNode = out.xyz;
    material.opacityNode = out.w.mul(materialOpacity);
    const geometry = new THREE.RingGeometry(GIANT_RINGS.from * radius, GIANT_RINGS.to * radius, 384, 6);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hero-planet-rings';
    mesh.renderOrder = 2;
    return { mesh, material, geometry };
}

/** A thin atmosphere shell, lit from its limb against the light. */
function createAtmosphere(u, radius) {
    const P = GIANT_PALETTE;
    const shellRadius = radius * 1.06;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-ringed-giant-air';
    material.fog = false;
    const centreW = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    const worldScale = length(modelWorldMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    const rayDir = normalize(positionWorld.sub(cameraPosition));
    const along = dot(centreW.sub(cameraPosition), rayDir);
    const closest = cameraPosition.add(rayDir.mul(along)).sub(centreW);
    const impact = length(closest).div(worldScale.mul(radius));
    const altitude = clamp(impact.sub(1.0).div(1.06 - 1.0), 0.0, 1.0);
    const thickness = pow(oneMinus(altitude), 3.0).mul(oneMinus(smoothstep(0.7, 1.0, altitude)));
    const sunN = normalize(u.uLight);
    const limbSun = dot(normalize(closest), sunN);
    const day = smoothstep(-0.2, 0.35, limbSun);
    const sunsetBand = smoothstep(-0.3, -0.02, limbSun).mul(oneMinus(smoothstep(0.02, 0.32, limbSun)));
    const backlight = pow(clamp(dot(rayDir, sunN), 0.0, 1.0), 6.0);
    const haloColor = mix(vec3Of(P.haze), vec3(1.0, 0.5, 0.25), sunsetBand.mul(0.8)).mul(u.uLightColor);
    const strength = thickness.mul(day.mul(0.55).add(sunsetBand.mul(0.45)).add(backlight.mul(1.2)));
    material.colorNode = haloColor.mul(strength);
    material.opacityNode = clamp(strength, 0.0, 1.0).mul(materialOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.BackSide;
    material.userData.emitsBloom = true;
    const geometry = new THREE.SphereGeometry(shellRadius, 96, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hero-planet-atmosphere';
    mesh.renderOrder = 3;
    return { mesh, material, geometry };
}

/**
 * Build the ringed giant. The returned group's local +Y is the pole: orient the group to tilt it.
 * @param {*} uTime shared time uniform
 * @param {{ radius?: number, segments?: number, uLight?: *, uLightColor?: * }} [options]
 */
export function createRingedGiantTSL(uTime, options = {}) {
    const radius = options.radius ?? 28;
    const u = {
        uTime: uTime ?? uniform(0),
        uLight: options.uLight ?? uniform(new THREE.Vector3(-0.3, 0.6, 0.7).normalize()),
        uLightColor: options.uLightColor ?? uniform(new THREE.Vector3(1.0, 0.88, 0.7)),
    };
    const surface = createSurface(u, radius, options.segments ?? 160);
    const rings = createRings(u, radius);
    const air = createAtmosphere(u, radius);
    return {
        surface, rings, air, uniforms: u,
    };
}
