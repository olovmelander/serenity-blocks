/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Blood Moon's world in one full-screen draw: a salt flat under a total lunar eclipse.
 *
 * Every pixel asks for the sky ONCE. A pixel above the horizon asks along its own view ray; a
 * pixel on the salt flat asks along that ray mirrored in the film of water, so the moon, the
 * stars, the Milky Way and the far range are mirrored exactly, at full resolution, with no
 * second pass. The flat itself is a crust of salt polygons (Voronoi cells about two metres
 * across) whose raised rims stand out of the water: near the lens they are crisp ridges lit
 * from the moon's side, far off they fade into a faint average so they never shimmer.
 *
 * The moon is drawn in the lens's image plane (the sunPlane idea from solar-eclipse-tsl.js),
 * so it is round on screen anywhere in the frame. Its face is the authored lunar atlas, lit by
 * lunarLight(): Earth's umbra in the moon's own plane, deep red at its heart, copper at its
 * rim, a turquoise fringe outside it, then the returning sun (blood-moon-eclipse.js holds the
 * same law in JavaScript and the cycle that moves the shadow).
 *
 * Exposure: everything the night shows is multiplied by U.exposure (the moon's own light by
 * U.moonGain), so when the sliver appears the frame stops down as a camera would.
 *
 * Hot play (blood-moon-state.js `crescendo`) moves four numbers, all 0 at rest: U.blood (the
 * moon's face saturates toward crimson and glows from within, most at the limb), U.bloodSky (a
 * crimson glow spreads round the moon and along the horizon, the airglow warms), U.agitation
 * (the film of water stirs: more wind, deeper rings, the moon's reflection breaks into a road)
 * and U.volcanoHeat (an ember wakes in the crater, an under-lit plume leans off the summit).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, asin, atan, clamp, cross, dot, exp, float, fwidth,
    int, length, max, min, mix, normalize, positionGeometry, reflect, select, sin, smoothstep,
    sqrt, step, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { ECLIPSE, LUNAR_COLOURS } from './blood-moon-eclipse.js';

import {
    lunarRoad, mineralRim, mountainRange, saltVeins, windOnFlat,
} from './blood-moon-landscape.js';
import { galacticRift, nightAtmosphere, starField } from './blood-moon-sky.js';

const TAU = Math.PI * 2;

/** World constants, in metres and radians. */
export const WORLD = Object.freeze({
    eyeHeight: 1.15,
    fov: 42,
    cell: 1.45,
    ridge: 0.09,
    /** Moon radiance per unit of lunarLight at exposure 1 (totality reads at about 1). */
    moonK: 175,
    /** Ground light per unit of the moon's mean light at exposure 1. */
    groundK: 120,
    ringSpeed: 2.1,
});

const c3 = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

/** The light on the moon's face `s` lunar radii from the shadow's axis (see blood-moon-eclipse.js). */
export const lunarLight = Fn(([s]) => {
    const { umbra, penumbra } = ECLIPSE;
    const u = clamp(s.div(umbra), 0, 1).toVar();
    const umbral = float(0.0007).add(u.mul(u).mul(0.0125));
    const red = mix(c3(LUNAR_COLOURS.deep), c3(LUNAR_COLOURS.copper), u.mul(u));
    const f0 = clamp(s.sub(umbra).div(penumbra - umbra), 0, 1).toVar();
    const f = max(f0, 0.000001).pow(1.25).toVar();
    const sun = mix(c3(LUNAR_COLOURS.sunLow), c3(LUNAR_COLOURS.sun), smoothstep(0, 0.3, f));
    const band = exp(s.sub(umbra + 0.07).div(0.11).pow2().negate()).mul(0.006);
    return red.mul(umbral).add(sun.mul(f)).add(c3(LUNAR_COLOURS.turquoise).mul(band));
}).setLayout({ name: 'bmLunarLight', type: 'vec3', inputs: [{ name: 's', type: 'float' }] });

// The stars wheel about this (tilted) pole: a degree every four minutes.
const STAR_POLE = new THREE.Vector3(-0.35, 0.6, 0.72).normalize();

/**
 * Build the world's material.
 * @param {object} U shared uniforms (see blood-moon.effect.js)
 * @param {{ moon: THREE.Texture, relief: THREE.Texture, clouds: THREE.Texture, galaxy: THREE.Texture, range: THREE.Texture, salt: THREE.Texture }} maps
 * @param {{ starLayers: number, surfaceSize: number, waterWaves: number }} tier
 */
export function createWorldMaterial(U, maps, tier) {
    const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    material.name = 'blood-moon-world';
    material.vertexNode = vec4(positionGeometry.xy, 0.9999, 1);

    material.colorNode = Fn(() => {
        const ndc = uv().mul(2).sub(1).toVar();
        const view = normalize(U.camFwd.add(U.camRight.mul(ndc.x.mul(U.tanHalf.x)))
            .add(U.camUp.mul(ndc.y.mul(U.tanHalf.y)))).toVar();
        const ground = view.y.lessThan(-0.00002);

        // ── The salt flat: where the view ray meets it, and how large a pixel is there ──
        const fall = max(view.y.negate(), 0.00002).toVar();
        const t = U.eye.y.div(fall).toVar();
        const P = U.eye.xz.add(view.xz.mul(t)).toVar();
        const fp = max(length(fwidth(P)), 1e-4).toVar();
        const near = float(1).sub(smoothstep(0.12, 0.3, fp)).toVar();

        const cell = mineralRim(texture(maps.salt, P.div(WORLD.cell * 12))).toVar();
        const rimM = cell.x.mul(WORLD.cell).toVar();
        const w = float(WORLD.ridge);
        // A rim is a low rounded bank of salt that tapers into the water on both sides.
        const sharp = float(1).sub(smoothstep(w.mul(0.3).sub(fp.mul(0.5)), w.add(fp.mul(0.5)), rimM));
        // Far off the rims sink below the film: the flat becomes a perfect mirror at the horizon.
        const crust = mix(float(0.07).mul(float(1).sub(smoothstep(0.3, 4, fp))), sharp, near).toVar();
        // Each polygon holds its own depth of water: some show more salt through it than others.
        const depth = mix(float(1), cell.w.mul(0.9).add(0.55), near).toVar();
        // A rim's flanks face away from its crest, toward each cell's middle.
        const flank = clamp(rimM.div(w), 0, 1).mul(0.55).mul(near);
        const crustNormal = normalize(vec3(cell.y.mul(flank).negate(), 1, cell.z.mul(flank).negate())).toVar();

        // ── The film of water: a breath of wind, and the rings the game drops on it ──
        const wind = vec2(0).toVar();
        If(ground, () => { wind.assign(windOnFlat(U, P, fp, tier.waterWaves)); });
        const ringAmp = U.agitation.mul(0.5).add(1).mul(0.022).toVar();
        const ringSlope = vec2(0).toVar();
        const ringLight = float(0).toVar();
        Loop({
            start: int(0), end: select(ground, int(U.rippleCount), int(0)), type: 'int', condition: '<', name: 'rip',
        }, ({ rip }) => {
            const row = U.ripples.element(rip);
            const rel = P.sub(row.xy).toVar();
            const dist = length(rel).toVar();
            const ahead = dist.sub(row.z.mul(WORLD.ringSpeed)).toVar();
            const width = row.z.mul(0.45).add(0.35);
            const env = exp(ahead.div(width).pow2().negate()).mul(exp(row.z.mul(-0.62))).mul(row.w)
                .mul(smoothstep(0, 0.15, row.z))
                .toVar();
            const wave = sin(ahead.mul(5.5)).mul(env);
            ringSlope.addAssign(rel.div(max(dist, 0.001)).mul(wave.mul(ringAmp)));
            ringLight.addAssign(env.mul(sin(ahead.mul(5.5).add(1.2)).mul(0.5).add(0.5)));
        });
        // The action still tilts the water and its reflection. Only the
        // additional light caught by the moving salt and crests is attenuated.
        ringLight.mulAssign(U.eventFlash);
        const slopeCap = U.agitation.mul(0.8).add(1).mul(0.035).toVar();
        const slope = clamp(wind.add(ringSlope), slopeCap.negate(), slopeCap);
        const waterNormal = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
        const mirrored = reflect(view, waterNormal).toVar();
        const up = normalize(vec3(mirrored.x, max(mirrored.y, 0.0004), mirrored.z));
        const d = select(ground, up, view).toVar();

        // ── The sky along d ──
        const level = max(length(d.xz), 0.0001);
        const el = d.y.div(level).toVar();
        const az = atan(d.x, d.z.negate()).toVar();
        const high = clamp(d.y, 0, 1).toVar();
        const zenith = mix(vec3(0.0058, 0.0027, 0.009), vec3(0.005, 0.009, 0.024), U.nightAir.z);
        const horizon = mix(vec3(0.067, 0.012, 0.026), vec3(0.032, 0.019, 0.042), U.nightAir.z);
        const toMoon = dot(d, U.moonDir).toVar();
        const air = mix(horizon, zenith, smoothstep(0, 0.55, high).pow(0.7)).mul(U.exposure).toVar();
        const atmosphere = nightAtmosphere(U, maps.clouds, az, el, toMoon, tier.starLayers > 1);
        air.addAssign(atmosphere.light);
        // Moonlit air: the moon's light scattered blue-first, strongest toward it and low down.
        air.addAssign(U.moonLight.mul(vec3(0.3, 0.55, 1)).mul(1.6)
            .mul(exp(toMoon.sub(1).mul(2.2)).mul(0.7).add(0.3))
            .mul(float(1).sub(high.mul(0.55))));
        // A low band of airglow, warmest under the moon; it warms as play heats.
        air.addAssign(vec3(0.024, 0.006, 0.008).mul(exp(abs(el).mul(-30))).mul(U.exposure)
            .mul(exp(toMoon.sub(1).mul(1.4)).mul(0.6).add(0.4))
            .mul(U.bloodSky.mul(1.2).add(1)));
        // The blood-red sky: a crimson glow spreading round the moon and low along the range.
        air.addAssign(vec3(0.06, 0.0026, 0.0052).mul(U.bloodSky).mul(U.exposure)
            .mul(exp(toMoon.sub(1).mul(11)).mul(0.75).add(exp(abs(el).mul(-12)).mul(0.22))));

        const range = mountainRange(U, maps.range, az, el, air);
        const mountains = range.colour;
        const land = range.coverage.toVar();

        // Night above the range.
        const night = air.toVar();
        const q = d.mul(U.skySpin.x).add(cross(vec3(STAR_POLE.x, STAR_POLE.y, STAR_POLE.z), d).mul(U.skySpin.y))
            .add(vec3(STAR_POLE.x, STAR_POLE.y, STAR_POLE.z).mul(dot(d, vec3(STAR_POLE.x, STAR_POLE.y, STAR_POLE.z)))
                .mul(float(1).sub(U.skySpin.x)))
            .toVar();
        const stars = starField(q, U, false).toVar();
        if (tier.starLayers > 1) stars.addAssign(starField(q, U, true));
        stars.addAssign(galacticRift(q, maps.galaxy, U));
        night.addAssign(stars.mul(U.starGain).mul(U.nightAir.w).mul(atmosphere.transmission)
            .mul(smoothstep(-0.012, 0.12, el)));

        // A meteor (blood-moon-meteors.js): a stretch of a great circle, a hot head and a trail
        // that cools and narrows behind it. Skipped outright when the sky holds none.
        const meteor = vec3(0).toVar();
        If(U.meteorGlow.greaterThan(0), () => {
            const along = atan(dot(d, U.meteorS), dot(d, U.meteorA));
            const off = dot(d, U.meteorN);
            const behind = U.meteorHead.sub(along).toVar();
            const width = max(U.texel.mul(0.9), 0.0005).mul(U.meteorFireball.mul(2.2).add(1)).toVar();
            const taper = clamp(float(1).sub(behind.div(max(U.meteorTrail, 0.0001))), 0, 1).toVar();
            // Close the train with a rounded cap at each scale. A single axial
            // cutoff across the wide airglow made the leading edge look sliced.
            const ahead = max(behind.negate(), 0).div(width).toVar();
            const inTrail = taper.pow2().mul(exp(ahead.pow2().negate()));
            const core = exp(off.div(width.mul(taper.mul(0.6).add(0.4))).pow2().negate());
            const trail = mix(vec3(1, 0.4, 0.2), vec3(1, 0.88, 0.72), taper.pow(3)).mul(core).mul(inTrail);
            const headR = length(vec2(behind.div(1.6), off)).div(width.mul(1.4));
            const head = mix(vec3(0.9, 1, 0.95), vec3(1, 0.89, 0.74), U.meteorFireball)
                .mul(exp(headR.mul(headR).negate()).mul(2.4).add(exp(headR.mul(headR).mul(-0.1)).mul(0.25)));
            // A fireball burns in a glow of its own air, along the trail and round the head.
            const haloWidth = width.mul(taper.mul(2.3).add(1.45));
            const halo = vec3(1, 0.35, 0.18).mul(exp(off.div(haloWidth).pow2().negate()))
                .mul(taper.pow2()).mul(exp(ahead.div(3.5).pow2().negate()))
                .mul(U.meteorFireball.mul(0.22));
            meteor.assign(trail.add(head).add(halo).mul(U.meteorGlow).mul(U.exposure.mul(0.5).add(0.5))
                .mul(step(0, dot(d, U.meteorA))));
        });
        night.addAssign(meteor.mul(smoothstep(-0.004, 0.03, el)));

        // The moon, in the lens's image plane: round wherever it stands in the frame.
        const facing = max(dot(d, U.camFwd), 0.001);
        const mp = vec2(dot(d, U.camRight), dot(d, U.camUp)).div(facing).sub(U.moonAt).div(U.moonTan)
            .toVar();
        const r = length(mp).toVar();
        const pxR = U.texel.div(U.moonTan);
        const disc = clamp(float(1).sub(r).div(pxR).add(0.5), 0, 1).mul(step(0, toMoon)).toVar();
        const moon = vec3(0).toVar();
        // LOD follows projected lunar texels (including the foreshortened limb). Only rays
        // through the disc or its reflection fetch the albedo and relief atlases.
        If(disc.greaterThan(0), () => {
            const pc = mp.div(max(r, 1)).toVar();
            const z = sqrt(max(float(1).sub(dot(pc, pc)), 0)).toVar();
            const n = vec3(pc.x, pc.y, z).toVar();
            const lunarUv = vec2(
                atan(n.x, n.z).div(TAU).add(0.5).add(U.moonRot),
                asin(clamp(n.y, -1, 1)).div(Math.PI).add(0.5),
            ).toVar();
            const lod = max(pxR.mul(tier.surfaceSize / TAU).div(max(z, 0.12)), 1).log2().toVar();
            const rock = texture(maps.moon, lunarUv).level(lod).r.toVar();
            const relief = texture(maps.relief, lunarUv).level(lod).xyz.mul(2).sub(1).toVar();
            const tangent = normalize(vec3(n.z.add(0.00001), 0, n.x.negate())).toVar();
            const bitangent = cross(n, tangent);
            const surface = normalize(tangent.mul(relief.x).add(bitangent.mul(relief.y)).add(n.mul(relief.z)));
            const key = normalize(vec3(-0.56, 0.63, 0.53));
            const raking = clamp(dot(surface, key).sub(dot(n, key)).mul(1.65).add(1), 0.55, 1.5);
            // Preserve the dark basalt seas against brighter ejecta in the highlands.
            const albedo = max(rock.sub(0.055), 0.015).pow(1.16).mul(2.32).toVar();
            const lit = lunarLight(length(pc.sub(U.shadow)));
            const limb = float(1).sub(z).toVar();
            const shade = z.mul(0.25).add(0.79).mul(raking);
            const red = lit.mul(albedo).mul(shade).mul(U.moonGain);
            const exposed = smoothstep(-0.3, 0.92, pc.y.sub(pc.x.mul(0.45)));
            const copper = vec3(1.0, 0.36, 0.13).mul(limb.pow(5)).mul(exposed).mul(U.exposure.mul(0.25));
            const heat = vec3(0.30, 0.012, 0.018).mul(U.blood.mul(U.exposure)).mul(albedo)
                .mul(limb.mul(limb).add(0.18));
            moon.assign(red.add(copper).add(heat).mul(atmosphere.transmission).add(atmosphere.light.mul(0.20)));
        });
        // The aureole: the moon's light scattered in our own air, close round its limb.
        const rim = max(r.sub(1), 0).toVar();
        const aureole = U.moonLight.mul(WORLD.moonK).mul(exp(rim.mul(-6.4)).mul(0.12)
            .add(exp(rim.mul(-1.35)).mul(0.037)).add(exp(rim.mul(-0.43)).mul(0.005)))
            .mul(U.corona.mul(2.2).add(1))
            .mul(step(0, toMoon));

        const sky = mix(night, mountains, land).add(aureole).toVar();
        // The volcano wakes with the game: an ember in its crater and a plume, lit from below,
        // leaning off the summit. Skipped outright while it sleeps.
        If(U.volcanoHeat.greaterThan(0.002), () => {
            const across = az.sub(U.volcanoAz).div(U.volcanoWidth).toVar();
            // The ember sits in the crater's notch, on the lip; the plume rises from it.
            const crater = exp(across.div(0.045).pow2().negate())
                .mul(exp(el.sub(U.volcanoHeight.mul(0.99)).div(U.volcanoHeight.mul(0.04)).pow2().negate()));
            const rise = max(el.sub(U.volcanoHeight.mul(1.01)), 0).div(U.volcanoHeight).toVar();
            const plume = exp(across.sub(rise.mul(0.5)).div(rise.mul(0.35).add(0.04)).pow2().negate())
                .mul(exp(rise.mul(-1.6))).mul(smoothstep(0, 0.04, rise));
            sky.addAssign(vec3(1, 0.08, 0.02).mul(crater.mul(0.9)).add(vec3(0.55, 0.06, 0.035).mul(plume.mul(0.22)))
                .mul(U.volcanoHeat)
                .mul(U.exposure.mul(0.6).add(0.4))
                .mul(step(0, d.y)));
        });
        sky.assign(mix(sky, moon, disc.mul(float(1).sub(land))));

        // ── The flat: crust lit by the moon, water mirroring the sky ──
        const L = U.moonDir;
        const groundLight = U.moonLight.mul(WORLD.groundK).toVar();
        // Starlight and airglow keep the salt pale even under a red moon.
        const ambient = vec3(0.026, 0.022, 0.032).mul(U.exposure).add(U.moonLight.mul(vec3(0.6, 0.8, 1.4)))
            .toVar();
        const salt = vec3(0.86, 0.82, 0.8);
        const crustLit = salt.mul(groundLight.mul(max(dot(crustNormal, L), 0)).add(ambient)).toVar();
        const cosI = clamp(dot(view.negate(), waterNormal), 0, 1);
        const m = float(1).sub(cosI).toVar();
        const fresnel = mix(m.mul(m).mul(m).mul(m).mul(m)
            .mul(0.98)
            .add(0.02), float(1), 0.55);
        // Salt shows through the shallow film beside each rim.
        const shallow = exp(rimM.sub(w).div(w.mul(1.4)).pow2().negate()).mul(near).mul(0.9).add(0.45);
        const bed = salt.mul(0.45).mul(shallow).mul(depth).mul(groundLight.mul(L.y.mul(0.7)).add(ambient));
        const water = sky.mul(fresnel).add(bed.mul(float(1).sub(fresnel)));
        const crustShare = crust.mul(float(1).sub(min(ringLight, 1).mul(0.3)));
        const flatColour = mix(water, crustLit, crustShare).toVar();
        If(ground, () => {
            flatColour.addAssign(saltVeins(U, rimM, w, fp, cell, near, groundLight, ringLight));
            flatColour.addAssign(lunarRoad(U, P, fp, mp, crust, near));
        });
        // A ring's crests catch the moon: red in totality, silver when the sliver shows. Where
        // many rings cross, the crests saturate instead of summing into a sheet of light.
        const crests = ringLight.sub(max(ringLight.sub(0.8), 0).mul(0.75));
        flatColour.addAssign(U.moonLight.mul(WORLD.moonK * 0.4).add(vec3(0.03, 0.002, 0.003).mul(U.exposure))
            .mul(crests));
        // At the far shore the film and its reflection meet the mountains themselves.
        const haze = float(1).sub(exp(t.mul(-0.00018)));
        flatColour.assign(mix(flatColour, sky, haze.mul(0.5)));

        return select(ground, flatColour, sky);
    })();
    return material;
}
