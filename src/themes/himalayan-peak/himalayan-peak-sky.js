/**
 * Himalayan Peak — the sky.
 *
 * One dome, shaded per view direction and drawn after everything solid, so it costs only where
 * sky shows: the gradient and the sun's scatter (hpSky, the function every other surface fades
 * into), the disc itself with its corona — the headwall hides it until the chain has raised it —
 * the last stars of the night, the Milky Way at moonrise, streaks of cirrus that catch the
 * sun long before the ground does, and far beyond the headwall a range of giants, blue with
 * distance, whose summits take the light first.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, If,
    abs,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    vec2,
    vec3,
} from 'three/tsl';
import { halfBits } from '../../rendering/half-float.js';
import {
    hpHash33, hpPart, hpPow4, hpSky, hpSq,
} from './himalayan-peak-tsl.js';

export const SKY_RADIUS = 46000;
/** The sun's disc as drawn: larger than life, as a long lens over a ridge shows it. */
export const SUN_RADIUS = 0.021;

const MILKY_NORMAL = new THREE.Vector3(0.64, 0.75, 0.17).normalize();

/**
 * The far range, 40 to 80 km beyond the headwall: its giants as [bearing, summit elevation,
 * slope] (degrees right of the view axis; degrees over the eye's level; elevation lost per degree
 * of bearing). They rise a degree to four over the headwall's skyline (6 to 8.5° from −14° to
 * +30°), most of all in the gap between the hero's flank and the headwall, and stay below the
 * skyline round the sun's bearing (30°), so they never hide the sunrise.
 */
export const FAR_PEAKS = Object.freeze([
    Object.freeze([-11.5, 11.9, 0.6]),
    Object.freeze([-5.0, 10.1, 0.74]),
    Object.freeze([2.5, 11.1, 0.56]),
    Object.freeze([6.2, 9.4, 0.9]),
    Object.freeze([9.5, 10.2, 0.68]),
    Object.freeze([13.2, 9.0, 0.85]),
    Object.freeze([17.0, 9.4, 0.64]),
    Object.freeze([21.5, 8.3, 0.8]),
]);
/** The range's own foot (degrees): everything under it is hidden by the headwall. */
const FAR_FOOT = 5.2;

// Cold summits in a second basin show through the first range's cols.
const BACK_PEAKS = [[-8.9, 11.6, 0.8], [-2.1, 10.9, 0.64], [5.0, 11.2, 0.73], [14.8, 10.45, 0.72], [20, 8.85, 0.75]];
const PROFILE_SAMPLES = 2048;
const RAD = Math.PI / 180;
let skylineData;

function ridgeAt(degrees, peaks) {
    let height = FAR_FOOT;
    let summit = degrees;
    peaks.forEach(([bearing, top, slope], i) => {
        const x = degrees - bearing;
        const side = x >= 0 ? 1 : -1;
        // Each spur breaks slope at its shoulder. Some summits are blades, some have a hanging shelf.
        const asymmetry = 1 + side * ((i % 3) - 1) * 0.18;
        const run = Math.abs(x);
        const shoulder = Math.min(run, 0.7 + (i % 3) * 0.34);
        const ledge = Math.min(Math.max(run - shoulder, 0), 0.7 + (i % 2) * 0.35);
        const face = top - (run + shoulder * 0.27 - ledge * 0.55) * slope * asymmetry;
        if (face > height) {
            height = face;
            summit = bearing;
        }
    });
    const exposure = 0.49 + 0.35 * Math.sin(degrees * 0.74 + 0.86 * Math.sin(degrees * 1.27));
    const crest = Math.sin(degrees * 2.6 + Math.sin(degrees * 1.3)) * 0.10
        + exposure * (Math.sin(degrees * 8.2 + Math.sin(degrees * 5.4)) * 0.075 + Math.sin(degrees * 21.7) * 0.03);
    return [height + crest, summit];
}

/** The two crest elevations and their summit bearings, in degrees, at a viewing angle. */
export function farRidgesAt(degrees) {
    return [...ridgeAt(degrees, FAR_PEAKS), ...ridgeAt(degrees, BACK_PEAKS)];
}

/** One angular sample gives both skylines and the bearing of the spine below each summit. */
function createSkylineTexture() {
    if (!skylineData) {
        skylineData = new Uint16Array(PROFILE_SAMPLES * 4);
        for (let i = 0; i < PROFILE_SAMPLES; i++) {
            const deg = ((i + 0.5) / PROFILE_SAMPLES - 0.5) * 100;
            const [front, frontSpine, back, backSpine] = farRidgesAt(deg);
            const offset = i * 4;
            skylineData[offset] = halfBits(front * RAD);
            skylineData[offset + 1] = halfBits(frontSpine * RAD);
            skylineData[offset + 2] = halfBits(back * RAD);
            skylineData[offset + 3] = halfBits(backSpine * RAD);
        }
    }
    const map = new THREE.DataTexture(skylineData, PROFILE_SAMPLES, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    map.name = 'HimalayanPeakFarSkylines';
    map.minFilter = THREE.LinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return map;
}

/**
 * @param {object} u  shared uniforms
 * @param {object} opts
 * @param {boolean} [opts.cirrus=true]
 */
export function createSky(u, { cirrus = true } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HimalayanPeakSky';
    material.fog = false;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    const skylineTexture = createSkylineTexture();
    material.addEventListener('dispose', () => skylineTexture.dispose());

    material.colorNode = Fn(() => {
        const seen = normalize(positionWorld.sub(cameraPosition));
        // The direction in the amphitheatre as it was planned (upright screens draw it narrower).
        const dir = normalize(vec3(seen.x.div(u.squeeze), seen.y, seen.z)).toVar();
        const up = clamp(dir.y, 0.0, 1.0);
        const az = atan(dir.x, dir.z.negate()).toVar();
        const el = atan(dir.y, length(dir.xz)).toVar();
        const blueHeight = smoothstep(0.14, 0.81, up).mul(0.56);
        // Only the air just above the sun's pass turns apricot. Violet dusk survives over the
        // snow peak on the other side of the valley, including while the sun is out of view.
        const lowSun = exp(hpSq(az.sub(0.52).div(0.42)).add(hpSq(el.sub(0.135).div(0.18))).negate());
        const afterglow = u.glow.mul(vec3(0.80, 1.04, 0.27)).mul(lowSun.mul(0.31)).mul(u.breath);
        const clearAir = mix(hpSky(u, dir), u.zenith.mul(1.3).mul(u.breath), blueHeight).add(afterglow).toVar();
        const col = clearAir.toVar();
        const cs = dot(dir, u.sunDir);
        // Angle from the sun, squared (small angles): no acos, no cancellation at the disc.
        const a2 = max(float(1.0).sub(cs).mul(2.0), 0.0);
        const r2 = SUN_RADIUS * SUN_RADIUS;

        // ── Stars: two layers of hashed cells; the day puts them out ──
        const veil = hpSq(max(cs, 0.0));
        const night = u.stars.mul(smoothstep(0.02, 0.3, up)).mul(float(1.0).sub(veil.mul(0.8)));
        const layer = (scale, cut, size) => {
            const g = dir.mul(scale).add(512);
            const h = hpHash33(floor(g));
            const f = fract(g).sub(0.5).sub(h.sub(0.5).mul(0.6));
            const twinkle = sin(u.time.mul(h.z.mul(1.3).add(0.65)).add(h.x.mul(40.0))).mul(0.12).add(0.88);
            const tint = mix(vec3(1.0, 0.90, 0.77), vec3(0.76, 0.86, 1.0), h.y);
            const magnitude = hpPow4(h.z).mul(2.15).add(0.22);
            return tint.mul(exp(dot(f, f).mul(-size)).mul(step(cut, h.x)).mul(twinkle).mul(magnitude));
        };
        const dust = u.noise(vec2(az.mul(1.45), el.mul(1.75)).add(0.62));
        const across = dot(dir, vec3(MILKY_NORMAL.x, MILKY_NORMAL.y, MILKY_NORMAL.z));
        const band = exp(hpSq(across.add(dust.w.sub(0.5).mul(0.09)).div(0.115)).negate());
        const rift = smoothstep(0.008, 0.041, abs(across.add(dust.x.sub(0.48).mul(0.17))));
        const deep = smoothstep(0.55, 1.0, u.stars);
        const clusters = band.mul(rift.mul(0.8).add(0.2)).mul(smoothstep(0.28, 0.72, dust.x));
        const stars = layer(112.0, 0.92, 90.0).mul(1.85)
            .add(layer(218.0, float(0.96).sub(clusters.mul(deep).mul(0.42)), 110.0).mul(1.05));
        col.addAssign(stars.mul(night));
        col.addAssign(mix(vec3(0.23, 0.27, 0.42), vec3(0.35, 0.27, 0.29), dust.w)
            .mul(clusters.mul(deep).mul(night).mul(0.27)));

        // Moonrise has a separate body above the west shoulder. The night palette both places
        // it in the sky and blends out the low solar disc as the last twilight recedes.
        const moonlight = smoothstep(0.70, 0.845, u.stars)
            .mul(smoothstep(-0.30, 0.15, u.sunCol.b.sub(u.sunCol.r))).toVar();
        const pixelAngle = max(fwidth(el), 1e-5).toVar();
        If(moonlight.greaterThan(0.001), () => {
            const travel = u.windRun.mul(0.00030);
            const moonAz = sin(travel.add(0.68)).mul(0.060).sub(0.29);
            const moonEl = sin(travel.mul(0.77)).mul(0.054).add(0.332);
            const radius = 0.0135;
            const q = vec2(az.sub(moonAz).mul(cos(moonEl)).mul(u.squeeze), el.sub(moonEl)).div(radius).toVar();
            const d2 = dot(q, q).toVar();
            If(d2.lessThan(12), () => {
                const d = sqrt(d2);
                const aa = pixelAngle.div(radius);
                const limb = smoothstep(aa.add(1), float(1).sub(aa), d);
                const z = sqrt(max(float(1).sub(d2), 0));
                const incidence = dot(q, vec2(0.72, -0.35)).sub(z.mul(0.60));
                const crescent = smoothstep(aa.negate(), aa.add(0.06), incidence)
                    .mul(clamp(incidence, 0, 1).mul(0.60).add(0.55));
                const mare = u.noise(q.mul(0.29).add(0.37)).level(1);
                const albedo = mare.w.mul(0.20).add(mare.x.mul(0.12)).add(0.76);
                const earthshine = vec3(0.083, 0.110, 0.158).mul(albedo);
                const silver = earthshine.add(vec3(3.3, 3.15, 2.88).mul(crescent).mul(albedo));
                const aureole = exp(d2.mul(-0.75)).mul(smoothstep(12, 8, d2)).mul(0.033);
                col.assign(mix(col, silver, limb.mul(moonlight)));
                col.addAssign(vec3(0.75, 0.85, 1).mul(aureole).mul(moonlight));
            });
        });

        // ── Cirrus: streaks drawn out along the wind, lit from below at dawn ──
        if (cirrus) {
            const run = u.windRun;
            const plane = dir.xz.div(max(dir.y, 0.0).add(0.12)).toVar();
            const field = u.noise(plane.mul(vec2(0.095, 0.115)).sub(vec2(run.mul(1.8e-5), 0.17)));
            const flow = plane.y.add(plane.x.mul(0.16)).add(field.w.sub(0.5).mul(0.76));
            const fibre = u.noise(vec2(plane.x.mul(0.21).sub(run.mul(4.2e-5)), flow.mul(0.96)).add(0.41));
            const threads = u.noise(vec2(plane.x.mul(0.69).sub(run.mul(9.0e-5)), flow.mul(3.6).add(fibre.w.mul(0.32))));
            const streak = smoothstep(0.39, 0.68, fibre.x.mul(0.46).add(field.x.mul(0.35)).add(threads.w.mul(0.19)));
            const wisp = smoothstep(0.29, 0.73, field.x).mul(streak).toVar();
            const fade = smoothstep(0.035, 0.21, dir.y);
            const high = smoothstep(-0.24, -0.04, u.sunTan);
            const forward = hpPow4(max(cs, 0.0));
            const thin = float(1).sub(wisp.mul(0.69));
            const lit = u.sunCol.mul(forward.mul(0.73).add(0.16)).mul(high).mul(thin);
            const cloud = u.shade.mul(0.73).add(u.horizon.mul(0.42)).add(u.zenith.mul(0.45)).add(lit);
            const cover = wisp.mul(fade).mul(float(0.69).sub(u.power.mul(0.18)));
            col.assign(mix(col, cloud.mul(u.breath.mul(0.65).add(0.35)), cover));

            // Two lenticular shelves condense downstream of the eastern ridge. Their underside
            // catches the last light as the thin crowns dissolve into the cirrus.
            const weather = sin(run.mul(0.0015).add(0.6)).mul(0.32)
                .add(sin(run.mul(0.00227).add(1.6)).mul(0.18)).add(0.5)
                .toVar();
            const lensX = az.sub(0.32).sub(sin(run.mul(0.00063)).mul(0.042));
            const level = float(0.30).add(lensX.mul(0.10)).add(weather.mul(0.025))
                .add(field.w.sub(0.5).mul(0.016))
                .add(fibre.w.sub(0.5).mul(0.008));
            const lens = (x, y, radius, thickness) => {
                const shape = max(float(1).sub(hpSq(x.div(radius))), 0).toVar();
                const half = shape.mul(thickness).add(0.004);
                return smoothstep(1.40, 0.04, abs(y).div(half)).mul(smoothstep(0.03, 0.64, shape));
            };
            const y = el.sub(level);
            const base = lens(lensX, y, 0.195, 0.014);
            const crown = lens(lensX.add(0.032), y.sub(0.031), 0.115, 0.008);
            const lamina = max(base, crown.mul(0.7)).mul(smoothstep(0.26, 0.91, weather));
            const under = smoothstep(0.012, -0.013, y).mul(base).add(crown.mul(0.52));
            const shelf = u.shade.mul(0.78).add(u.horizon.mul(0.32))
                .add(u.sunCol.mul(under.mul(0.45).add(0.07)).mul(high));
            col.assign(mix(col, shelf.mul(u.breath), lamina.mul(fibre.w.mul(0.27).add(0.20))));
        }

        // ── The far range: giants beyond the headwall, blue with distance ──
        {
            const profiles = texture(skylineTexture, vec2(az.div(100 * RAD).add(0.5), 0.5)).toVar();
            const top = profiles.r;
            const w = max(fwidth(el), 1e-5);
            const cover = smoothstep(w.negate(), w, top.sub(el)).toVar();
            const backCover = smoothstep(w.negate(), w, profiles.b.sub(el));
            const below = max(top.sub(el), 0.0).toVar();
            const depth = clamp(below.div(5.0 * RAD), 0.0, 1.0);
            const spine = az.sub(profiles.g).add(below.mul(0.52)).toVar();
            // The spurs fall diagonally away from a broken snow arête. Its edge comes in and
            // out of shadow independently of the gullies that cut across its lower slopes.
            const flank = smoothstep(-0.006, 0.009, spine);
            const along = az.add(below.mul(mix(float(-0.85), float(1.05), flank)));
            const rib = u.noise(vec2(along.mul(17.0), el.mul(4.3)).add(0.53)).toVar();
            const flute = u.noise(vec2(along.mul(52.0), el.mul(13.0))).toVar();
            const facing = smoothstep(-0.017, 0.011, spine.add(rib.x.sub(0.5).mul(below).mul(1.2)));
            const spur = smoothstep(0.34, 0.67, rib.w.mul(0.72).add(flute.x.mul(0.28)));
            const rock = smoothstep(0.48, 0.80, spur.mul(0.48).add(depth.mul(0.45)).add(flute.w.mul(0.21)));
            const snow = float(1).sub(rock.mul(0.64));
            const reach = smoothstep(-0.26, 0.24, u.sunTan).mul(1.24).add(0.13);
            const edge = depth.add(rib.x.sub(0.5).mul(0.31));
            const lit = smoothstep(edge.sub(0.085), edge.add(0.085), reach)
                .mul(facing.mul(0.64).add(spur.mul(0.24)).add(0.1));
            const shade = u.shade.mul(0.92).add(u.horizon.mul(0.19)).mul(spur.mul(0.24).add(0.76)).mul(snow);
            const glow = u.sunCol.mul(lit).mul(snow).mul(0.32);
            const front = mix(shade.add(glow).mul(u.breath), clearAir, depth.mul(0.19).add(0.16));
            const backFacing = smoothstep(-0.015, 0.02, az.sub(profiles.a).sub(profiles.b.sub(el).mul(0.7)));
            const back = mix(u.shade.mul(1.45), clearAir, 0.61)
                .add(u.sunCol.mul(backFacing.mul(0.14).add(0.04)).mul(rib.w.mul(0.28).add(0.72)).mul(u.breath));
            col.assign(mix(mix(col, back, backCover), front, cover));
        }

        // ── The sun: a limb-darkened disc in a corona ──
        const edge = smoothstep(r2 * 1.12, r2 * 0.86, a2);
        const limb = float(1.0).sub(a2.div(r2).mul(0.32));
        const disc = u.sunCol.mul(edge.mul(limb).mul(9.0));
        const corona = u.sunCol.mul(exp(a2.div(-r2 * 7.0)).mul(0.6).add(exp(sqrt(a2).mul(-13.0)).mul(0.14)));
        // (Nothing of it below the horizon: the cloud sea is not always opaque down there.)
        const sun = disc.mul(float(1).sub(moonlight)).add(corona);
        col.addAssign(sun.mul(u.breath).mul(smoothstep(-0.03, 0.0, dir.y)));
        // Twenty-two degrees out, the ring that ice in the air draws round a low sun: red on
        // its inner edge, fading outward. Four lines call it up; a board cleared whole, fully;
        // a back-to-back marks it, and a fever holds it up.
        const out = sqrt(a2).sub(0.384);
        const ring = exp(hpSq(out.div(0.011)).negate()).add(exp(max(out, 0.0).mul(-34.0)).mul(step(0.0, out)).mul(0.45));
        const tint = mix(vec3(1.0, 0.5, 0.3), vec3(0.75, 0.9, 1.0), smoothstep(-0.012, 0.03, out));
        col.addAssign(u.sunCol.mul(tint).mul(ring.mul(u.halo).mul(0.16)).mul(smoothstep(0.0, 0.08, dir.y)));
        // Level with the sun either side of it, 22 degrees off (on the ring while the sun is
        // low, a little outside it as it climbs), the ice draws two mock suns: red toward the
        // sun, a pale tail outward. They come with the ring, the brightest of it.
        const right = vec3(u.sunFlat.y.negate(), 0.0, u.sunFlat.x);
        const sinEl = u.sunDir.y;
        const cosEl2 = max(float(1.0).sub(sinEl.mul(sinEl)), 1e-3);
        const turnCos = clamp(float(Math.cos(0.384)).sub(sinEl.mul(sinEl)).div(cosEl2), -1.0, 1.0);
        const turnSin = sqrt(float(1.0).sub(turnCos.mul(turnCos)));
        const cosEl = sqrt(cosEl2);
        const mockSun = (side) => {
            const flat = vec3(u.sunFlat.x, 0.0, u.sunFlat.y).mul(turnCos).add(right.mul(turnSin.mul(side)));
            const at = vec3(flat.x.mul(cosEl), sinEl, flat.z.mul(cosEl));
            const off = dir.sub(at);
            const outward = dot(off, right).mul(side);
            const spot = exp(hpSq(outward.sub(0.004).div(0.008)).add(hpSq(off.y.div(0.014))).negate());
            const tail = exp(hpSq(off.y.div(0.006)).negate())
                .mul(exp(max(outward, 0.0).mul(-11.0))).mul(step(0.0, outward));
            const hue = mix(vec3(1.0, 0.36, 0.16), vec3(1.0, 0.94, 0.82), smoothstep(-0.008, 0.01, outward));
            return hue.mul(spot.mul(2.2).add(tail.mul(0.45))).mul(step(0.0, dot(dir, at)));
        };
        const mock = mockSun(1).add(mockSun(-1)).mul(u.halo.mul(0.6));
        col.addAssign(u.sunCol.mul(mock).mul(smoothstep(0.0, 0.08, dir.y)));
        // A cold column of suspended ice answers a perfect clear. Horizontal plate ice
        // catches the low sun in a pillar; the tangent arc opens in two wings above it.
        If(u.crown.greaterThan(0.001).and(a2.lessThan(0.48)), () => {
            const lateral = dot(dir, right).toVar();
            const rise = dir.y.sub(sinEl).toVar();
            const span = abs(lateral).toVar();
            const pillarWidth = max(float(0.015).sub(max(rise, 0.0).mul(0.026)), 0.004);
            const pillar = exp(hpSq(lateral.div(pillarWidth)).negate())
                .mul(smoothstep(-0.08, 0.015, rise)).mul(exp(max(rise, 0.0).mul(-8.5)));
            const tangent = rise.sub(cosEl.mul(0.365)).sub(span.mul(0.55)).add(span.mul(span).mul(1.15));
            const spanFade = smoothstep(0.37, 0.035, span);
            const amber = exp(hpSq(tangent.div(0.009)).negate());
            const opal = exp(hpSq(tangent.sub(0.015).div(0.018)).negate());
            const arc = vec3(1.0, 0.56, 0.28).mul(amber.mul(0.34))
                .add(vec3(0.58, 0.82, 1.0).mul(opal.mul(0.26))).mul(spanFade);
            col.addAssign(u.sunCol.mul(pillar.mul(0.57).add(arc)).mul(u.crown));
            // When a hot sun climbs, its 22° arc can crest above the lens. Fine ice
            // in the cirrus also diffracts a close, opalescent corona round the disc.
            // The scattered colour is broad, and breaks up where the veil thins.
            If(a2.lessThan(0.04), () => {
                const radius = sqrt(a2).toVar();
                const patch = sin(lateral.mul(53.0).add(rise.mul(27.0))).mul(0.24).add(0.74);
                const coronaBand = radius.sub(0.084).add(lateral.mul(rise).mul(0.56));
                const violet = exp(hpSq(coronaBand.add(0.018).div(0.022)).negate());
                const honey = exp(hpSq(coronaBand.sub(0.026).div(0.017)).negate());
                const iceTint = vec3(0.38, 0.64, 1.0).mul(violet)
                    .add(vec3(1.0, 0.49, 0.29).mul(honey));
                const strength = patch.mul(u.crown).mul(u.nearSun);
                col.mulAssign(float(1.0).sub(violet.mul(strength).mul(0.24)));
                col.addAssign(iceTint.mul(strength).mul(0.55));
            });
        });
        return col;
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    return hpPart('HimalayanPeakSky', geometry, material, 20);
}
