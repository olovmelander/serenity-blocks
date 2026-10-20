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
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, asin, atan, clamp, cross, dot, exp, float, floor, fract, fwidth,
    int, length, max, min, mix, mod, normalize, positionGeometry, reflect, select, sin, smoothstep,
    sqrt, step, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { ECLIPSE, LUNAR_COLOURS } from './blood-moon-eclipse.js';

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

const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const hash22 = (p) => fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));
const hash33 = (p) => fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)),
)).mul(43758.5453));

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

/**
 * The salt crust's cells at q (cell units): x = distance to the nearest rim, yz = the unit
 * direction from the cell toward that rim, w = the cell's own hash. Inigo Quilez's two-pass
 * border distance; `reach` is the second pass's half-width (2 exact, 1 for the low tiers).
 */
function makeSaltCells(reach) {
    return Fn(([q]) => {
        const n = floor(q).toVar();
        const f = fract(q).toVar();
        const mg = vec2(0).toVar();
        const mr = vec2(0).toVar();
        const md = float(8).toVar();
        Loop({
            start: int(-1), end: int(1), condition: '<=', type: 'int', name: 'cy',
        }, ({ cy }) => {
            Loop({
                start: int(-1), end: int(1), condition: '<=', type: 'int', name: 'cx',
            }, ({ cx }) => {
                const g = vec2(float(cx), float(cy));
                const o = hash22(mod(n.add(g), 289)).sub(0.5).mul(0.86).add(0.5);
                const r = g.add(o).sub(f).toVar();
                const dd = dot(r, r).toVar();
                If(dd.lessThan(md), () => { md.assign(dd); mr.assign(r); mg.assign(g); });
            });
        });
        const bd = float(8).toVar();
        const bn = vec2(0, 1).toVar();
        Loop({
            start: int(-reach), end: int(reach), condition: '<=', type: 'int', name: 'by',
        }, ({ by }) => {
            Loop({
                start: int(-reach), end: int(reach), condition: '<=', type: 'int', name: 'bx',
            }, ({ bx }) => {
                const g = mg.add(vec2(float(bx), float(by))).toVar();
                const o = hash22(mod(n.add(g), 289)).sub(0.5).mul(0.86).add(0.5);
                const r = g.add(o).sub(f).toVar();
                const diff = r.sub(mr).toVar();
                If(dot(diff, diff).greaterThan(1e-5), () => {
                    const nn = normalize(diff).toVar();
                    const dist = dot(mr.add(r).mul(0.5), nn).toVar();
                    If(dist.lessThan(bd), () => { bd.assign(dist); bn.assign(nn); });
                });
            });
        });
        return vec4(bd, bn, hash21(mod(n.add(mg), 289)));
    }).setLayout({ name: `bmSaltCells${reach}`, type: 'vec4', inputs: [{ name: 'q', type: 'vec2' }] });
}

// The Milky Way's great circle: up out of the range to the right, over the top toward the left.
const MILKY = (() => {
    const a = new THREE.Vector3(Math.sin(0.62), 0.02, -Math.cos(0.62)).normalize();
    const el = 0.95;
    const az = -0.55;
    const b = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    const pole = new THREE.Vector3().crossVectors(a, b).normalize();
    const side = new THREE.Vector3().crossVectors(pole, a).normalize();
    return { a, side, pole };
})();
// The stars wheel about this (tilted) pole: a degree every four minutes.
const STAR_POLE = new THREE.Vector3(-0.35, 0.6, 0.72).normalize();

/**
 * Build the world's material.
 * @param {object} U shared uniforms (see blood-moon.effect.js)
 * @param {{ moon: THREE.Texture, relief: THREE.Texture, clouds: THREE.Texture }} maps
 * @param {{ starLayers: number, milky: boolean, cellReach: number }} tier
 */
export function createWorldMaterial(U, maps, tier) {
    const saltCells = makeSaltCells(tier.cellReach ?? 2);
    const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    material.name = 'blood-moon-world';
    material.vertexNode = vec4(positionGeometry.xy, 0.9999, 1);

    const starLayer = (q, scale, power, gain) => {
        const p = q.mul(scale);
        const cell = floor(p);
        const h = hash33(cell).toVar();
        const star = normalize(cell.add(h.mul(0.56).add(0.22)));
        const off = q.sub(star).mul(scale);
        const bright = h.y.pow(power).mul(smoothstep(0.55, 0.62, h.x));
        const twinkle = sin(U.time.mul(h.x.mul(1.9).add(0.7)).add(h.z.mul(40))).mul(0.28).add(0.72);
        // Mostly warm white, a share of red giants, a few blue-white.
        const tint = mix(
            mix(vec3(1, 0.86, 0.74), vec3(1, 0.42, 0.34), step(0.72, h.z)),
            vec3(0.74, 0.84, 1),
            step(0.93, h.z),
        );
        return tint.mul(exp(dot(off, off).mul(-160)).mul(bright).mul(twinkle).mul(gain));
    };

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

        const cell = vec4(8, 0, 1, 0.5).toVar();
        If(ground.and(near.greaterThan(0.001)), () => {
            cell.assign(saltCells(P.div(WORLD.cell)));
        });
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
        const windFade = float(1).sub(smoothstep(0.03, 0.25, fp));
        const wind = vec2(
            sin(P.x.mul(1.9).add(P.y.mul(0.7)).add(U.time.mul(0.9)).add(sin(P.y.mul(0.23)).mul(2)))
                .add(sin(P.x.mul(-0.6).add(P.y.mul(3.1)).sub(U.time.mul(1.3))).mul(0.6)),
            sin(P.y.mul(2.3).sub(P.x.mul(0.4)).add(U.time.mul(1.1)).add(sin(P.x.mul(0.31)).mul(2)))
                .add(sin(P.y.mul(-0.8).add(P.x.mul(2.6)).add(U.time.mul(0.7))).mul(0.6)),
        ).mul(0.00045).mul(windFade).toVar();
        const ringSlope = vec2(0).toVar();
        const ringLight = float(0).toVar();
        Loop({
            start: int(0), end: int(U.rippleCount), type: 'int', condition: '<', name: 'rip',
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
            ringSlope.addAssign(rel.div(max(dist, 0.001)).mul(wave.mul(0.022)));
            ringLight.addAssign(env.mul(sin(ahead.mul(5.5).add(1.2)).mul(0.5).add(0.5)));
        });
        const slope = clamp(wind.add(ringSlope), -0.035, 0.035);
        const waterNormal = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();
        const mirrored = reflect(view, waterNormal).toVar();
        const up = normalize(vec3(mirrored.x, max(mirrored.y, 0.0004), mirrored.z));
        const d = select(ground, up, view).toVar();

        // ── The sky along d ──
        const level = max(length(d.xz), 0.0001);
        const el = d.y.div(level).toVar();
        const az = atan(d.x, d.z.negate()).toVar();
        const high = clamp(d.y, 0, 1).toVar();
        const zenith = vec3(0.0010, 0.0012, 0.0034);
        const horizon = vec3(0.022, 0.0072, 0.0105);
        const toMoon = dot(d, U.moonDir).toVar();
        const air = mix(horizon, zenith, smoothstep(0, 0.55, high).pow(0.7)).mul(U.exposure).toVar();
        // Moonlit air: the moon's light scattered blue-first, strongest toward it and low down.
        air.addAssign(U.moonLight.mul(vec3(0.3, 0.55, 1)).mul(1.6)
            .mul(exp(toMoon.sub(1).mul(2.2)).mul(0.7).add(0.3))
            .mul(float(1).sub(high.mul(0.55))));
        // A low band of airglow, warmest under the moon.
        air.addAssign(vec3(0.024, 0.006, 0.008).mul(exp(abs(el).mul(-30))).mul(U.exposure)
            .mul(exp(toMoon.sub(1).mul(1.4)).mul(0.6).add(0.4)));

        // The far range, and a volcano with snow on its shoulders, to the right of the board.
        // Several summits in any width of view, so a narrow portrait frame still sees a range.
        const ridgeLine = float(0.006).add(sin(az.mul(4.1).add(0.7)).mul(0.5).add(0.5).pow(2)
            .mul(0.0065))
            .add(sin(az.mul(9.7).add(2.3)).mul(0.5).add(0.5).pow(3)
                .mul(0.0045))
            .add(abs(sin(az.mul(17.3).add(1.1))).mul(0.003))
            .add(sin(az.mul(41).add(4)).mul(0.0012))
            .add(sin(az.mul(97).add(2)).mul(0.0006));
        const cone = max(float(1).sub(abs(az.sub(U.volcanoAz)).div(U.volcanoWidth)), 0).toVar();
        // A stratovolcano: concave flanks, a blunt summit with a shallow notch of crater.
        // Its height follows its width, so a narrow portrait frame keeps a volcano's proportions.
        const volcano = cone.pow(1.7).mul(U.volcanoHeight).sub(cone.pow(14).mul(U.volcanoHeight.mul(0.12)))
            .sub(exp(az.sub(U.volcanoAz).div(U.volcanoWidth.mul(0.04)).pow2().negate()).mul(0.0022));
        const crest = max(ridgeLine, volcano).toVar();
        const land = smoothstep(U.texel.negate(), U.texel, crest.sub(el)).mul(step(0, d.y)).toVar();
        // Only the volcano's own slopes take the moon: the flank facing it, snow on its shoulders.
        const onCone = smoothstep(0, 0.004, volcano.sub(ridgeLine));
        const moonSide = smoothstep(-0.2, 0.6, az.sub(U.volcanoAz).negate().div(U.volcanoWidth)).mul(onCone);
        const snow = smoothstep(U.volcanoHeight.mul(0.55), U.volcanoHeight.mul(0.71), el).mul(onCone);
        const rangeLight = U.moonLight.mul(WORLD.groundK).mul(mix(float(0.025), float(0.3), snow))
            .mul(moonSide.mul(0.85).add(0.15));
        const mountains = horizon.mul(U.exposure).mul(0.42).add(rangeLight)
            .mul(mix(float(1), float(0.6), smoothstep(0, 0.03, el)))
            .add(air.mul(exp(el.mul(-90)).mul(0.5)));

        // Night above the range.
        const night = air.toVar();
        const q = d.mul(U.skySpin.x).add(cross(vec3(STAR_POLE.x, STAR_POLE.y, STAR_POLE.z), d).mul(U.skySpin.y))
            .add(vec3(STAR_POLE.x, STAR_POLE.y, STAR_POLE.z).mul(dot(d, vec3(STAR_POLE.x, STAR_POLE.y, STAR_POLE.z)))
                .mul(float(1).sub(U.skySpin.x)))
            .toVar();
        const milkyLift = float(1).toVar();
        if (tier.milky) {
            const off = dot(q, vec3(MILKY.pole.x, MILKY.pole.y, MILKY.pole.z)).toVar();
            const along = atan(
                dot(q, vec3(MILKY.side.x, MILKY.side.y, MILKY.side.z)),
                dot(q, vec3(MILKY.a.x, MILKY.a.y, MILKY.a.z)),
            ).toVar();
            const clouds = texture(maps.clouds, vec2(along.mul(0.42), off.mul(1.5).add(0.37))).toVar();
            const lanes = texture(maps.clouds, vec2(along.mul(0.9).add(0.21), off.mul(3.1).add(0.6))).r;
            const core = exp(along.sub(0.55).pow2().mul(-1.6)).toVar();
            const band = exp(off.mul(off).mul(core.mul(10).sub(26))).mul(clouds.r.mul(1.25).add(0.18))
                .mul(core.mul(1.4).add(0.5))
                .mul(float(1).sub(smoothstep(0.25, 0.75, lanes).mul(exp(off.mul(off).mul(-90))).mul(0.8)));
            const glow = mix(vec3(0.42, 0.4, 0.52), vec3(0.78, 0.55, 0.5), clouds.b.mul(0.6).add(core.mul(0.4)));
            night.addAssign(glow.mul(band).mul(0.045).mul(U.starGain));
            milkyLift.assign(band.mul(2.2).add(1));
            // Its grain: a dense lattice of faint points where the band is, thinned in the lanes.
            night.addAssign(starLayer(q, 240, 3, 0.5).mul(band.mul(band)).mul(U.starGain));
        }
        const stars = starLayer(q, 46, 8, 1.9).toVar();
        if (tier.starLayers > 1) stars.addAssign(starLayer(q, 112, 6, 0.55));
        // Stars thin out toward the horizon's thick air.
        night.addAssign(stars.mul(milkyLift).mul(U.starGain).mul(smoothstep(-0.005, 0.12, el)));

        // A meteor (blood-moon-meteors.js): a stretch of a great circle, a hot head and a trail
        // that cools and narrows behind it. Skipped outright when the sky holds none.
        const meteor = vec3(0).toVar();
        If(U.meteorGlow.greaterThan(0), () => {
            const along = atan(dot(d, U.meteorS), dot(d, U.meteorA));
            const off = dot(d, U.meteorN);
            const behind = U.meteorHead.sub(along).toVar();
            const width = max(U.texel.mul(0.9), 0.0005).mul(U.meteorFireball.mul(2.2).add(1)).toVar();
            const taper = clamp(float(1).sub(behind.div(max(U.meteorTrail, 0.0001))), 0, 1).toVar();
            const inTrail = smoothstep(-0.0015, 0.0005, behind).mul(taper.mul(taper));
            const core = exp(off.div(width.mul(taper.mul(0.6).add(0.4))).pow2().negate());
            const trail = mix(vec3(1, 0.4, 0.2), vec3(1, 0.88, 0.72), taper.pow(3)).mul(core).mul(inTrail);
            const headR = length(vec2(behind.div(1.6), off)).div(width.mul(1.4));
            const head = mix(vec3(0.9, 1, 0.92), vec3(0.62, 1, 0.7), U.meteorFireball)
                .mul(exp(headR.mul(headR).negate()).mul(2.4).add(exp(headR.mul(headR).mul(-0.1)).mul(0.25)));
            // A fireball burns in a glow of its own air, along the trail and round the head.
            const halo = vec3(1, 0.35, 0.18).mul(exp(off.div(width.mul(5)).pow2().negate())).mul(inTrail)
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
        const pc = mp.div(max(r, 1)).toVar();
        const z = sqrt(max(float(1).sub(dot(pc, pc)), 0)).toVar();
        const n = vec3(pc.x, pc.y, z).toVar();
        const lunarUv = vec2(
            atan(n.x, n.z).div(TAU).add(0.5).add(U.moonRot),
            asin(clamp(n.y, -1, 1)).div(Math.PI).add(0.5),
        );
        const albedo = texture(maps.moon, lunarUv).r.toVar();
        const relief = texture(maps.relief, lunarUv).xyz.mul(2).sub(1).toVar();
        const tangent = normalize(vec3(n.z.add(0.00001), 0, n.x.negate())).toVar();
        const bitangent = cross(n, tangent);
        const surface = normalize(tangent.mul(relief.x.mul(1.05)).add(bitangent.mul(relief.y.mul(1.05)))
            .add(n.mul(relief.z)));
        const key = normalize(vec3(-0.22, 0.18, 1));
        const flat = max(dot(n, key), 0);
        const shade = clamp(float(1).add(max(dot(surface, key), 0).sub(flat).mul(2.4)), 0.35, 1.7)
            .mul(z.mul(0.18).add(0.82));
        const lit = lunarLight(length(pc.sub(U.shadow)));
        const moon = lit.mul(albedo.mul(1.5)).mul(shade).mul(U.moonGain).toVar();
        // The aureole: the moon's light scattered in our own air, close round its limb.
        const rim = max(r.sub(1), 0).toVar();
        const aureole = U.moonLight.mul(WORLD.moonK).mul(exp(rim.mul(-5.5)).mul(0.016)
            .add(exp(rim.mul(-1.2)).mul(0.004)).add(exp(rim.mul(-0.32)).mul(0.0011)))
            .mul(U.corona.mul(2.2).add(1))
            .mul(step(0, toMoon));

        const sky = mix(night, mountains, land).add(aureole).toVar();
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
        // A ring's crests catch the moon: red in totality, silver when the sliver shows.
        flatColour.addAssign(U.moonLight.mul(WORLD.moonK * 0.4).add(vec3(0.03, 0.002, 0.003).mul(U.exposure))
            .mul(ringLight));
        // The far flat dissolves into the horizon's air.
        const haze = float(1).sub(exp(t.mul(-0.00018)));
        flatColour.assign(mix(flatColour, horizon.mul(U.exposure).mul(0.7), haze.mul(0.5)));

        return select(ground, flatColour, sky);
    })();
    return material;
}
