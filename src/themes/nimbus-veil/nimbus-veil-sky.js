/**
 * Nimbus Veil — the sky dome: gradient, low golden sun with its glow and sunbeams, distant
 * cumulus banks on the horizon, high cirrus wisps.
 *
 * One draw, a function of the view direction only. Drawn AFTER the opaque cloud sea with the
 * depth test on, so early-Z rejects every pixel the clouds already cover and the sky shades only
 * the visible sky. Below the horizon it returns the colour of the air on that bearing (nvAir),
 * the same colour the cloud sea's haze dissolves into, so the sea line has no seam.
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
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    vec2,
} from 'three/tsl';
import {
    nvAir,
    nvDomesH,
    nvFbm3,
    nvNoise2,
    nvSkyGradient,
    nvSunAlign,
    nvSunGlow,
    rgb,
} from './nimbus-veil-tsl.js';

/** Sky dome radius: beyond everything it must sit behind, inside RIG.far. */
export const SKY_RADIUS = 6000;

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.cirrus=true]
 * @param {boolean} [opts.banks=true]  distant cumulus banks along the horizon
 */
export function createSky(u, opts = {}) {
    const withCirrus = opts.cirrus !== false;
    const withBanks = opts.banks !== false;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const e = dir.y.toVar();
        const hLen = max(length(vec2(dir.x, dir.z)), 1e-4);
        const sa = nvSunAlign(dir.z.div(hLen)).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();
        const pulse = u.sunPulse;

        // Sun frame: local tangent coordinates ≈ angle from the sun centre (radians).
        const lx = dot(dir, u.sunRight).toVar();
        const ly = dot(dir, u.sunUp).toVar();
        const facing = step(0.0, dot(dir, u.sunDir));
        const ang = length(vec2(lx, ly)).toVar();
        const fwA = max(fwidth(ang), 1e-5);
        const above = smoothstep(-0.0015, 0.0006, e).toVar();

        // ── Sunbeams: the shadows of clouds beyond the horizon fan out from the sun across its
        // glow. Read on a circle round the sun (no seam), drifting very slowly. ──
        const around = atan(ly, lx);
        const ring = vec2(cos(around), sin(around)).mul(3.2).add(vec2(u.time.mul(0.005), 0.0));
        const beamN = nvFbm3(ring);
        const beam = smoothstep(0.25, 0.8, beamN);
        const beamFade = smoothstep(0.0, 0.06, e).mul(smoothstep(0.05, 0.25, ang))
            .mul(exp(ang.mul(-1.4)));
        const glow = nvSunGlow(dir, pulse).mul(float(1.0).add(beam.sub(0.5).mul(0.5).mul(beamFade)));
        const col = nvSkyGradient(e, sa).add(glow).toVar();

        // ── Sun disc: white-gold, softly limb-darkened ──
        const r = ang.div(u.sunRadius);
        const aa = fwA.div(u.sunRadius);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), r))
            .mul(facing).mul(above);
        const limb = mix(float(1.0), float(0.82), r.mul(r));
        col.assign(mix(col, rgb(0xfff4dc, 5.0).mul(limb).mul(float(1.0).add(pulse.mul(0.5))), disc));

        // ── Distant cumulus banks: a cauliflower skyline a degree or so high, in some bearings
        // only, hazed nearly into the air. Backlit toward the sun (a dark body with a burning
        // rim), lit rose away from it. ──
        if (withBanks) {
            // Derivatives only in uniform control flow: the edge's width is taken out here.
            const fwE = max(fwidth(e), 1e-5).mul(1.6).toVar();
            If(e.lessThan(0.04), () => {
                const mask = smoothstep(0.5, 0.8, nvNoise2(vec2(az.mul(3.1), 7.7)));
                const big = nvDomesH(vec2(az.mul(22.0), 0.5), 1e4);
                const small = nvDomesH(vec2(az.mul(80.0).add(3.1), 2.5), 1e4);
                const top = mask.mul(big.mul(big).mul(0.038).add(small.mul(0.007))).add(0.0012).toVar();
                const below = top.sub(e).toVar();
                const inside = smoothstep(fwE.negate(), fwE, below).mul(step(0.0015, top));
                // How deep into the bank: its base sinks into the haze on the sea line.
                const body = smoothstep(0.0, 0.7, below.div(max(top, 1e-4)));
                const lit = mix(rgb(0xf0b9c4, 0.95), rgb(0x9a86bd, 0.62), clamp(sa.mul(1.6), 0.0, 1.0));
                const bankCol = mix(col, lit, mix(float(0.18), float(0.5), body));
                // The rim: sun light through the bank's thin top edge, hottest toward the sun.
                const rim = exp(below.div(0.0016).negate()).mul(sa.mul(1.8).add(0.25));
                const rimCol = rgb(0xffc890, 1.6).mul(rim).mul(pulse.mul(0.4).add(1.0));
                col.assign(mix(col, bankCol.add(rimCol), inside));
            });
        }

        // ── Cirrus: thin high wisps, silver-gold near the sun ──
        if (withCirrus) {
            const wide = exp(ang.mul(-2.6)).mul(float(0.55).add(pulse.mul(0.4))).mul(facing);
            const core = exp(ang.mul(-14.0)).mul(float(1.1).add(pulse.mul(1.2))).mul(facing);
            If(e.greaterThan(0.06), () => {
                const cc = vec2(az.mul(2.6).add(u.time.mul(0.004)), e.mul(9.0).add(az.mul(0.8)));
                const n = nvFbm3(cc);
                const env = smoothstep(0.06, 0.16, e).mul(float(1.0).sub(smoothstep(0.42, 0.7, e)));
                const wisp = smoothstep(0.52, 0.8, n).mul(env).mul(0.55);
                const litW = clamp(wide.mul(1.4).add(core.mul(0.5)), 0.0, 1.8);
                const tint = mix(rgb(0xf3e6f4), rgb(0xffd6a6, 1.3), clamp(litW, 0.0, 1.0))
                    .mul(float(0.75).add(litW.mul(0.6)));
                col.assign(mix(col, tint, wisp));
            });
        }

        return mix(nvAir(dir, pulse), col, above);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}
