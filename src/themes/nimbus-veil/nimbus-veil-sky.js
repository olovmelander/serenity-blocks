/**
 * Nimbus Veil — the sky dome: the gradient of the hour, the sun with its glow and its fan of
 * beams, the high cloud that streams over the deck, the light the ice in the air draws round the
 * sun, distant cumulus banks on the horizon, and the night's own sky.
 *
 * One draw, a function of the view direction only. Drawn AFTER the opaque cloud sea with the
 * depth test on, so early-Z rejects every pixel the clouds already cover and the sky shades only
 * the visible sky. Below the horizon it returns the colour of the air on that bearing (nvAir),
 * the same colour the cloud sea's haze dissolves into, so the sea line has no seam.
 *
 * The high cloud (the ceiling) lies on a plane over the eye: a direction reads it at
 * dir.xz / dir.y, so its fibres and rows converge on the horizon the way a real cloud layer's do.
 * The air (nimbus-veil-weather.js) says how much of it there is and of what kind: long fibres of
 * cirrus, or the small cloudlets of a mackerel sky (the same dome field the deck is made of). It
 * is lit the way thin cloud is: bright where it thins, white-gold toward the sun, and from BELOW
 * once the sun is low, so an evening ceiling burns while the deck under it is already in shade.
 *
 * Two of the events' own instruments live here: the wave of light that crosses the ceiling for
 * four lines, and a twist's mother-of-pearl in the cloud near the sun. The corona itself and a
 * cascade's rays are drawn in front of the towers (nimbus-veil-optics.js).
 *
 * The night (a uniform branch: by day the whole sky skips it) has stars of several sizes, the
 * Milky Way, a young crescent with earthshine over the place the sun went down, the evening star
 * and now and then a shooting star.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
    min,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    EVENING_STAR,
    MOON,
    bearingVector,
    nvAir,
    nvDomesH,
    nvFbm3,
    nvHash21,
    nvNoise2,
    nvSkyGradient,
    nvSpectrum,
    nvSunAlign,
    nvSunGlow,
    rgb,
} from './nimbus-veil-tsl.js';

/** Sky dome radius: beyond everything it must sit behind, inside RIG.far. */
export const SKY_RADIUS = 6000;

/** The ceiling's fibres stream along this bearing (radians from −z, toward +x). */
export const CEILING_WIND = THREE.MathUtils.degToRad(-28);

const fromAzEl = (az, el) => new THREE.Vector3(...bearingVector(az, el));

/** The Milky Way's plane: it rises from the horizon right of the sun and leans over to the left. */
const MILKY_NORMAL = fromAzEl(40, 0).cross(fromAzEl(-20, 50)).normalize();

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.banks=true]    distant cumulus banks along the horizon
 * @param {boolean} [opts.ripples=true]  the mackerel sky's cloudlets (off: every air's ceiling is fibres)
 * @param {boolean} [opts.fine=true]     the third octave in the ceiling's fibres
 * @param {boolean} [opts.milkyWay=true] the Milky Way and the second, finer layer of stars
 */
export function createSky(u, opts = {}) {
    const withBanks = opts.banks !== false;
    const withRipples = opts.ripples !== false;
    const fine = opts.fine !== false;
    const withMilky = opts.milkyWay !== false;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    const windC = Math.cos(CEILING_WIND);
    const windS = Math.sin(CEILING_WIND);
    const moonDir = fromAzEl(MOON.az, MOON.el);
    const moonRight = new THREE.Vector3(0, 1, 0).cross(moonDir).normalize().negate();
    const moonUp = moonDir.clone().cross(moonRight).normalize().negate();
    const venus = fromAzEl(EVENING_STAR.az, EVENING_STAR.el);
    const v3 = (v) => vec3(v.x, v.y, v.z);

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const e = dir.y.toVar();
        const hLen = max(length(vec2(dir.x, dir.z)), 1e-4);
        const sa = nvSunAlign(dir.z.div(hLen)).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();
        const pulse = u.sunPulse;
        const m = u.mood;

        // Sun frame: local tangent coordinates ≈ angle from the sun centre (radians).
        const lx = dot(dir, u.sunRight).toVar();
        const ly = dot(dir, u.sunUp).toVar();
        const facing = step(0.0, dot(dir, u.sunDir)).toVar();
        const ang = length(vec2(lx, ly)).toVar();
        const fwA = max(fwidth(ang), 1e-5).toVar();
        const above = smoothstep(-0.0015, 0.0006, e).toVar();
        // Derivatives are taken here, in uniform control flow: a star's cell, the banks' edge and
        // the ceiling's plane (one unit = the layer's height over the eye).
        const fwS = max(fwidth(az), fwidth(e)).toVar();
        const fwE = max(fwidth(e), 1e-5).mul(1.6).toVar();
        const plane = vec2(dir.x, dir.z).div(max(e, 0.02)).toVar();
        const footP = max(fwidth(plane.x), fwidth(plane.y)).toVar();

        // ── Sunbeams: the shadows of clouds beyond the horizon fan out from the sun across its
        // glow. Read on a circle round the sun (no seam), drifting very slowly; a twist turns
        // the fan (u.beamTurn). A broken ceiling (u.air2.x) and the heat of play (u.blaze.x)
        // sharpen it into a crown: the beams reach further, the gaps between them deepen and the
        // beams themselves burn gold. ──
        const blaze = u.blaze.x;
        const around = atan(ly, lx).add(u.beamTurn);
        const ring = vec2(cos(around), sin(around)).mul(3.2).add(vec2(u.time.mul(0.005), 0.0));
        const beam = smoothstep(0.25, 0.8, nvFbm3(ring)).toVar();
        const beamFade = smoothstep(0.0, 0.06, e).mul(smoothstep(0.05, 0.25, ang))
            .mul(exp(ang.mul(min(blaze, 1.4).mul(0.35).sub(1.4)))).toVar();
        const beamDepth = blaze.mul(0.9).add(u.air2.x.mul(0.55)).add(0.4);
        const glow = nvSunGlow(u, dir, pulse)
            .mul(float(1.0).add(beam.sub(0.5).mul(beamDepth).mul(beamFade))).toVar();
        const col = nvSkyGradient(u, e, sa).add(glow).toVar();
        // Gold in the beams near the sun, fading before they reach the deep sky.
        col.addAssign(rgb(0xffa040, 0.9).mul(beam.mul(beam).mul(beamFade).mul(exp(ang.mul(-1.2))).mul(blaze)));

        // ── The night: stars of several sizes, the Milky Way, the young moon, the evening star,
        // a shooting star. The mood's starlight gates it all (a uniform branch). ──
        If(u.starGain.greaterThan(0.001), () => {
            const veil = smoothstep(0.04, 0.3, e).mul(float(1.0).sub(sa.mul(0.8)))
                .mul(float(1.0).sub(smoothstep(0.0, 0.6, glow.x))).toVar();
            const px = fwS.mul(110.0).toVar();
            const stars = vec3(0.0).toVar();
            const milk = float(0.0).toVar();
            if (withMilky) {
                // The band: a soft river of light with darker lanes, and more stars inside it.
                const off = dot(dir, v3(MILKY_NORMAL));
                const band = exp(off.mul(off).mul(-34.0)).toVar();
                const dust = nvFbm3(vec2(az.mul(3.1).add(off.mul(9.0)), e.mul(5.5)));
                milk.assign(band.mul(smoothstep(0.25, 0.8, dust)));
                stars.addAssign(mix(rgb(0x8f9fe0), rgb(0xe6c8d8), dust).mul(milk.mul(0.085)));
            }
            const layer = (scale, seed, floorAt, gain) => {
                const sp = vec2(az.mul(scale), e.mul(scale));
                const cell = floor(sp);
                const hx = nvHash21(cell.add(seed));
                const hy = nvHash21(cell.add(vec2(19.7, 4.3)).add(seed));
                const there = step(floorAt.sub(milk.mul(0.2)), nvHash21(cell.add(vec2(7.3, 11.1)).add(seed)));
                const d = length(fract(sp).sub(vec2(hx, hy).mul(0.8).add(0.1)));
                const size = max(px.mul(scale / 110).mul(0.9), 0.05 + 0.03 * (110 / scale));
                const core = float(1.0).sub(smoothstep(size.mul(0.35), size, d));
                const twinkle = sin(u.time.mul(hx.mul(2.0).add(0.8)).add(hy.mul(40.0))).mul(0.25).add(0.75);
                // A few are bright, most are faint: the fourth power of a flat draw.
                const h2 = hy.mul(hy);
                const bright = h2.mul(h2).mul(2.6).add(0.2);
                return mix(rgb(0xcfdcff), rgb(0xffe6c8), hx).mul(core.mul(there).mul(twinkle).mul(bright).mul(gain));
            };
            stars.addAssign(layer(110, 0, float(0.86), 1.0));
            if (withMilky) stars.addAssign(layer(64, 31.7, float(0.9), 1.7));
            col.addAssign(stars.mul(veil).mul(u.starGain));

            // The young moon: a thin crescent lit from the place the sun went down, the rest of
            // its disc in earthshine.
            const night = smoothstep(0.1, 0.7, u.starGain).toVar();
            const mq = vec2(dot(dir, v3(moonRight)), dot(dir, v3(moonUp))).div(MOON.radius).toVar();
            const mr = length(mq);
            If(mr.lessThan(6.0), () => {
                const aaM = fwA.div(MOON.radius).mul(1.2);
                const disc = float(1.0).sub(smoothstep(float(1.0).sub(aaM), float(1.0).add(aaM), mr));
                // The dark limb is the disc pushed up and away from the sun.
                const dark = length(mq.sub(vec2(0.3, 0.42)));
                const lit = disc.mul(smoothstep(float(1.0).sub(aaM), float(1.0).add(aaM), dark));
                const halo = exp(mr.mul(-1.1)).mul(0.07);
                const moon = rgb(0xfff0d6, 2.6).mul(lit).add(rgb(0x6a7fb8, 0.3).mul(disc))
                    .add(rgb(0xbcc8ff).mul(halo));
                col.assign(mix(col, col.mul(float(1.0).sub(disc)).add(moon), night));
            });
            // The evening star: a point with a soft glow.
            const vd = length(dir.sub(v3(venus)));
            const point = max(fwA.mul(1.3), 0.0016);
            col.addAssign(rgb(0xfff6e6, 3.0).mul(exp(vd.mul(vd).div(point.mul(point)).negate())
                .add(exp(vd.mul(-120.0)).mul(0.12))).mul(night));

            // Shooting stars: each a line from its tail to its head, brightest at the head.
            const here = vec2(az, e);
            const wide = max(fwS.mul(1.2), 0.0018);
            const streak = (line, gain) => {
                const a = vec2(line.z, line.w);
                const ba = vec2(line.x, line.y).sub(a);
                const pa = here.sub(a);
                const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0.0, 1.0);
                const d = length(pa.sub(ba.mul(h)));
                return exp(d.mul(d).div(wide.mul(wide)).negate()).mul(h.mul(h)).mul(gain);
            };
            col.addAssign(rgb(0xeaf2ff, 2.4)
                .mul(streak(u.meteorA, u.meteorGain.x).add(streak(u.meteorB, u.meteorGain.y))));
        });

        // ── Sun disc: white-gold today, softly limb-darkened ──
        const r = ang.div(u.sunRadius);
        const aa = fwA.div(u.sunRadius);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), r))
            .mul(facing).mul(above);
        const limb = mix(float(1.0), float(0.82), r.mul(r));
        col.assign(mix(col, m.sunDisc.mul(limb).mul(float(1.0).add(pulse.mul(0.5))), disc));

        // ── Distant cumulus banks: a cauliflower skyline a degree or so high, in some bearings
        // only, hazed nearly into the air. Backlit toward the sun (a dark body with a burning
        // rim), lit rose away from it. ──
        if (withBanks) {
            If(e.lessThan(0.04), () => {
                const mask = smoothstep(0.5, 0.8, nvNoise2(vec2(az.mul(3.1), 7.7)));
                const big = nvDomesH(vec2(az.mul(22.0), 0.5), 1e4);
                const small = nvDomesH(vec2(az.mul(80.0).add(3.1), 2.5), 1e4);
                const top = mask.mul(big.mul(big).mul(0.038).add(small.mul(0.007))).add(0.0012).toVar();
                const below = top.sub(e).toVar();
                const inside = smoothstep(fwE.negate(), fwE, below).mul(step(0.0015, top));
                // How deep into the bank: its base sinks into the haze on the sea line.
                const body = smoothstep(0.0, 0.7, below.div(max(top, 1e-4)));
                const lit = mix(m.bankLit, m.bankShade, clamp(sa.mul(1.6), 0.0, 1.0));
                const bankCol = mix(col, lit, mix(float(0.18), float(0.5), body));
                // The rim: sun light through the bank's thin top edge, hottest toward the sun.
                const rim = exp(below.div(0.0016).negate()).mul(sa.mul(1.8).add(0.25));
                const rimCol = m.bankRim.mul(rim).mul(pulse.mul(0.4).add(1.0));
                col.assign(mix(col, bankCol.add(rimCol), inside));
            });
        }

        // ── The ceiling: the high cloud, read on its plane. ──
        If(e.greaterThan(0.018), () => {
            // The wind's frame: fibres stream along x.
            const q = vec2(
                plane.x.mul(windC).sub(plane.y.mul(windS)),
                plane.x.mul(windS).add(plane.y.mul(windC)),
            ).toVar();
            const flow = u.ceilFlow;
            // Where there is cloud at all: fields of it with clear sky between.
            const big = nvNoise2(q.mul(0.46).add(vec2(flow.x.mul(0.5).add(3.7), 1.9))).toVar();
            const warp = nvNoise2(q.mul(1.3).add(vec2(flow.x, 7.1))).sub(0.5).mul(1.5)
                .add(nvNoise2(q.mul(4.3).add(vec2(flow.x.mul(2.0).add(5.5), 2.3))).sub(0.5).mul(0.5));
            const fp = vec2(q.x.mul(0.5).add(flow.x.mul(1.6)), q.y.mul(6.2).add(warp)).toVar();
            // Far out, where a fibre is finer than a pixel, the fibres melt into a milky sheet.
            const fibRoom = float(1.0).sub(smoothstep(0.14, 0.5, footP.mul(6.2)));
            const fib = mix(float(0.5), fine
                ? nvFbm3(fp)
                : nvNoise2(fp).mul(0.64).add(nvNoise2(fp.mul(2.03).add(vec2(17.1, 3.7))).mul(0.36)), fibRoom).toVar();
            const thr = mix(float(0.8), float(0.33), u.air.x).toVar();
            // Feathered: a fibre thickens slowly from nothing, so its edges are never ruled.
            const dens = smoothstep(thr, thr.add(0.46), fib.mul(big.mul(0.9).add(0.55))).toVar();
            if (withRipples) {
                If(u.air.y.greaterThan(0.01), () => {
                    // The rows are never ruled: a slow warp bends them and squeezes the cloudlets.
                    const bend = vec2(
                        nvNoise2(q.mul(1.9).add(vec2(flow.x.mul(2.0).add(21.0), 3.3))),
                        nvNoise2(q.mul(1.9).add(vec2(flow.x.mul(2.0).add(5.0), 17.7))),
                    ).sub(0.5).mul(1.5);
                    const drift = vec2(flow.x.mul(9.0).add(40.0), flow.y.mul(6.0).add(40.0));
                    const cells = nvDomesH(vec2(q.x.mul(8.2), q.y.mul(12.6)).add(bend).add(drift), 1e4);
                    // Far out, where a cloudlet is finer than a pixel, the rows melt into a sheet.
                    const room = float(1.0).sub(smoothstep(0.1, 0.42, footP.mul(12.6)));
                    const cl = mix(float(0.57), cells, room);
                    // The rows stand in fields with clear sky between.
                    const field = nvNoise2(q.mul(1.1).add(vec2(flow.x.mul(1.2).add(9.3), 2.7)));
                    const patch = smoothstep(thr.sub(0.2), thr.add(0.12), big.mul(0.62).add(field.mul(0.5)).add(0.12));
                    // Only the taller domes stand as cloudlets: blue shows between them.
                    // (A trace of this kind in the air is no kind at all: it comes in past a fifth.)
                    // (The fibres' own grain runs through them, so no two cloudlets are one tone.)
                    dens.assign(mix(
                        dens,
                        smoothstep(0.44, 0.8, cl).mul(patch).mul(fib.mul(0.55).add(0.62)),
                        smoothstep(0.2, 0.9, u.air.y),
                    ));
                });
            }
            const env = smoothstep(0.018, 0.14, e).toVar();
            // The sun shows through: the cloud thins in front of it.
            const alpha = dens.mul(env).mul(mix(float(0.56), float(0.8), u.air.y))
                .mul(float(1.0).sub(exp(ang.mul(-9.0)).mul(facing).mul(0.6))).toVar();

            // Thin cloud is bright where it thins and dull where it is thick; toward the sun it
            // scatters white-gold; and a low sun lights it from below (u.ceil.x), strongest on
            // its thin rims.
            const edge = dens.mul(float(1.0).sub(dens)).mul(4.0);
            const thick = smoothstep(0.55, 1.0, dens);
            const wide = exp(ang.mul(-2.6)).mul(facing);
            const core = exp(ang.mul(-11.0)).mul(facing);
            const body = m.cirrusA.mul(edge.mul(0.3).add(0.74)).mul(float(1.0).sub(thick.mul(0.34)));
            const under = m.cirrusT.mul(u.ceil.x).mul(edge.mul(0.55).add(0.45)).mul(float(1.0).sub(thick.mul(0.45)));
            const fwd = m.cirrusT.mul(wide.mul(0.8).add(core.mul(1.5))).mul(pulse.mul(0.4).add(1.0));
            const cloud = body.add(under).add(fwd).toVar();
            // A twist's mother-of-pearl: the cloud near the sun takes the colours of thin ice.
            const pearl = nvSpectrum(fract(ang.mul(7.0).add(fib.mul(1.6)).sub(u.optics.y)));
            cloud.addAssign(pearl.mul(u.optics.x).mul(exp(ang.mul(-3.2))).mul(facing).mul(0.9));
            col.assign(mix(col, cloud, alpha));

            // Four lines: a wave of light crosses the ceiling from the horizon to overhead, in
            // step with the one on the deck. It burns on the cloud and shows as a faint arc on
            // clear sky; a perfect clear's wave carries the spectrum.
            const wave = u.skyWave;
            const off = length(plane).sub(wave.x).mul(wave.y).toVar();
            const band = exp(off.mul(off).negate()).mul(wave.z).mul(env);
            // (The spectrum is let down with white: light through ice, not paint.)
            // Deep gold, not white: over a pale sky a wave reads by its colour, and by the shade
            // that runs just ahead of it.
            const bow = nvSpectrum(clamp(off.mul(0.3).add(0.5), 0.0, 1.0)).mul(1.25).add(0.4);
            const waveCol = mix(u.lampTint.mul(2.2), bow, wave.w).mul(u.lampInfo.z);
            const lead = off.add(1.7);
            col.mulAssign(float(1.0).sub(exp(lead.mul(lead).negate()).mul(wave.z).mul(env).mul(0.2)));
            // The cloud catches most of it; clear sky shows it as an arc of light all the same.
            col.addAssign(waveCol.mul(band).mul(dens.mul(0.6).add(0.4)));
        });

        return mix(nvAir(u, dir, pulse), col, above);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}
