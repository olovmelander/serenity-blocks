/**
 * Nimbus Veil — the sky dome: gradient, low golden sun with its glow, high cirrus wisps.
 *
 * One draw, a function of the view direction only. Drawn AFTER the opaque cloud sea with the
 * depth test on, so early-Z rejects every pixel the clouds already cover and the sky shades only
 * the visible sky. Below the horizon it returns the haze colour the cloud sea fades into.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    step,
    vec2,
} from 'three/tsl';
import {
    nvFbm3,
    nvHazeColor,
    nvSkyGradient,
    nvSunAlign,
    rgb,
} from './nimbus-veil-tsl.js';

/** Sky dome radius: beyond everything it must sit behind, inside RIG.far. */
export const SKY_RADIUS = 6000;

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.cirrus=true]
 */
export function createSky(u, opts = {}) {
    const withCirrus = opts.cirrus !== false;
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
        const col = nvSkyGradient(e, sa).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();

        // Sun frame: local tangent coordinates ≈ angle from the sun centre (radians).
        const lx = dot(dir, u.sunRight).toVar();
        const ly = dot(dir, u.sunUp).toVar();
        const facing = step(0.0, dot(dir, u.sunDir));
        const ang = length(vec2(lx, ly)).toVar();
        const fwA = max(fwidth(ang), 1e-5);
        const above = smoothstep(-0.0015, 0.0006, e).toVar();
        const pulse = u.sunPulse;

        // ── Glow: a wide warm bloom, a tight core glow, a band along the horizon ──
        const wide = exp(ang.mul(-2.6)).mul(float(0.55).add(pulse.mul(0.4))).mul(facing).toVar();
        const core = exp(ang.mul(-14.0)).mul(float(1.1).add(pulse.mul(1.2))).mul(facing).toVar();
        const band = exp(abs(e).mul(-22.0)).mul(exp(abs(lx).mul(-2.2))).mul(0.5).mul(facing);
        col.addAssign(rgb(0xffb070).mul(wide).add(rgb(0xffe2b0).mul(core)).add(rgb(0xffc18a).mul(band)));

        // ── Sun disc: white-gold, softly limb-darkened ──
        const r = ang.div(u.sunRadius);
        const aa = fwA.div(u.sunRadius);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), r))
            .mul(facing).mul(above);
        const limb = mix(float(1.0), float(0.82), r.mul(r));
        col.assign(mix(col, rgb(0xfff4dc, 5.0).mul(limb).mul(float(1.0).add(pulse.mul(0.5))), disc));

        // ── Cirrus: thin high wisps, silver-gold near the sun ──
        if (withCirrus) {
            If(e.greaterThan(0.06), () => {
                const cc = vec2(az.mul(2.6).add(u.time.mul(0.004)), e.mul(9.0).add(az.mul(0.8)));
                const n = nvFbm3(cc);
                const env = smoothstep(0.06, 0.16, e).mul(float(1.0).sub(smoothstep(0.42, 0.7, e)));
                const wisp = smoothstep(0.52, 0.8, n).mul(env).mul(0.55);
                const lit = clamp(wide.mul(1.4).add(core.mul(0.5)), 0.0, 1.8);
                const tint = mix(rgb(0xf3e6f4), rgb(0xffd6a6, 1.3), clamp(lit, 0.0, 1.0))
                    .mul(float(0.75).add(lit.mul(0.6)));
                col.assign(mix(col, tint, wisp));
            });
        }

        return mix(nvHazeColor(sa), col, above);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}
