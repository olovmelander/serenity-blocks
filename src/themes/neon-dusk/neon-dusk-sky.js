/**
 * Neon Dusk — the sky dome: dusk gradient, the great setting sun, stratus bars burning across
 * it, twinkling stars, and the event layers (hologram rings out of the sun, shooting stars).
 *
 * One draw, a function of the view direction only. Drawn AFTER the opaque mountains and floor
 * with the depth test on, so early-Z rejects every pixel they already cover. The glass floor's
 * reflector renders this same dome from the mirrored camera, so the sun, the clouds and the rings
 * all appear in the floor for free.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
    min,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    vec2,
} from 'three/tsl';
import {
    ndFbm3,
    ndHash21,
    ndHash22,
    ndHazeColor,
    ndSkyGradient,
    ndSunAlign,
    rgb,
} from './neon-dusk-tsl.js';

/** Sky dome radius: beyond everything it must sit behind, inside RIG.far. */
export const SKY_RADIUS = 6000;

/**
 * The sun's face colour for a vertical position v on the disc (−1 bottom … 1 top): pale gold at
 * the crown, molten orange, hot pink at the base — HDR, so the whole disc blooms.
 */
export const ndSunColor = /* @__PURE__ */ Fn(([v]) => {
    const t = clamp(v.mul(0.5).add(0.5), 0.0, 1.0);
    const c = mix(rgb(0xff2d78, 1.6), rgb(0xff6a1a, 1.9), smoothstep(0.05, 0.45, t)).toVar();
    c.assign(mix(c, rgb(0xffc23a, 2.3), smoothstep(0.42, 0.8, t)));
    c.assign(mix(c, rgb(0xfff0a0, 2.8), smoothstep(0.82, 1.0, t)));
    return c;
}).setLayout({ name: 'nd_sunColor', type: 'vec3', inputs: [{ name: 'v', type: 'float' }] });

/** Gaussian ring at r for slot P = (radius, 1/width, energy, 0). */
const ringTerm = (r, P) => {
    const d = r.sub(P.x).mul(P.y);
    return exp(d.mul(d).negate()).mul(P.z);
};

/**
 * A shooting star for slot S = (azimuth, elevation, heading, age); dead when age ≥ 1 (life is
 * normalised). Returns its brightness at sky coordinates (az, e).
 */
const shootingStar = (az, e, S, fwA) => {
    const dir = vec2(cos(S.z), sin(S.z));
    const head = vec2(S.x, S.y).add(dir.mul(S.w.mul(0.22)));
    const rel = vec2(az, e).sub(head);
    const along = dot(rel, dir);
    const across = abs(rel.x.mul(dir.y).sub(rel.y.mul(dir.x)));
    const tail = float(0.09);
    const inTail = step(along.negate(), tail).mul(step(along, 0.002));
    const fade = clamp(along.div(tail).add(1.0), 0.0, 1.0);
    const width = max(float(0.0009), fwA.mul(0.8));
    const core = float(1.0).sub(smoothstep(width.mul(0.5), width.mul(1.6), across));
    const life = smoothstep(0.0, 0.08, S.w).mul(float(1.0).sub(smoothstep(0.7, 1.0, S.w)));
    return core.mul(inTail).mul(fade.mul(fade)).mul(life).mul(step(S.w, 1.0));
};

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.clouds=true]
 * @param {number}  [opts.starDensity=1]  0 disables the stars
 */
export function createSky(u, opts = {}) {
    const withClouds = opts.clouds !== false;
    const starDensity = opts.starDensity ?? 1;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const e = dir.y.toVar();
        const hLen = max(length(vec2(dir.x, dir.z)), 1e-4);
        const sa = ndSunAlign(dir.z.div(hLen)).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();
        const fwA = max(fwidth(az), 1e-5).toVar();
        const col = ndSkyGradient(e, sa).toVar();

        // Sun frame: local tangent coordinates ≈ angle from the sun centre (radians).
        const lx = dot(dir, u.sunRight).toVar();
        const ly = dot(dir, u.sunUp).toVar();
        const facing = step(0.0, dot(dir, u.sunDir)).toVar();
        const ang = length(vec2(lx, ly)).toVar();
        const r = ang.div(u.sunRadius).toVar();
        const fwR = max(fwidth(r), 1e-5).toVar();
        const above = smoothstep(-0.002, 0.0008, e).toVar();
        const pulse = u.sunPulse;

        // ── Stars: hashed cells in sky coordinates, fading out toward the warm horizon ──
        if (starDensity > 0) {
            const sp = vec2(az.mul(95.0), e.mul(95.0));
            const fwS = max(fwidth(sp.x), fwidth(sp.y));
            const cell = floor(sp);
            const h = ndHash22(cell);
            const present = step(1.0 - 0.16 * starDensity, ndHash21(cell.add(7.3)));
            const d = length(fract(sp).sub(h.mul(0.8).add(0.1)));
            const size = max(fwS.mul(0.9), 0.05);
            const core = float(1.0).sub(smoothstep(size.mul(0.4), size, d));
            const twinkle = sin(u.time.mul(h.x.mul(3.0).add(1.2)).add(h.y.mul(40.0))).mul(0.35).add(0.65);
            const bright = h.y.mul(h.y).mul(1.6).add(0.25);
            const fadeIn = smoothstep(0.09, 0.32, e).mul(float(1.0).sub(sa.mul(0.6)));
            col.addAssign(mix(rgb(0xbfd4ff), rgb(0xffc8f0), h.x).mul(core.mul(present).mul(twinkle)
                .mul(bright)
                .mul(fadeIn)));
        }

        // ── Glow: a wide magenta bloom, a hot core glow, a band along the horizon ──
        const wide = exp(ang.mul(-3.8)).mul(float(0.3).add(pulse.mul(0.4))).mul(facing).toVar();
        const core = exp(ang.mul(-7.5)).mul(float(0.85).add(pulse.mul(0.9))).mul(facing).toVar();
        const band = exp(abs(e).mul(-28.0)).mul(exp(abs(lx).mul(-1.6))).mul(0.65).mul(facing);
        col.addAssign(rgb(0xff3a8c).mul(wide).add(rgb(0xff9a5a).mul(core)).add(rgb(0xff6a6a).mul(band)));

        // ── The sun: a banded gradient disc, gaps widening toward its base ──
        const v = ly.div(u.sunRadius);
        const discMask = float(1.0).sub(smoothstep(float(1.0).sub(fwR), float(1.0).add(fwR), r))
            .mul(facing).mul(above)
            .toVar();
        const bandPos = clamp(v.negate().mul(1.6).add(0.15), 0.0, 1.0);
        const stripe = fract(v.mul(5.2).add(u.time.mul(0.06)));
        const fwStripe = max(fwidth(v.mul(5.2)), 1e-4);
        const gap = bandPos.mul(0.55);
        const slit = smoothstep(gap.sub(fwStripe), gap.add(fwStripe), stripe).mul(step(0.001, gap))
            .add(step(gap, 0.001));
        const limb = mix(float(1.0), float(0.8), r.mul(r));
        const sunCol = ndSunColor(v).mul(limb).mul(float(1.0).add(pulse.mul(0.6)));
        col.assign(mix(col, sunCol, discMask.mul(slit)));

        // ── Stratus bars: long thin clouds above the ridgeline, crossing the sun's crown. They
        // burn pink and gold where the sun lights them and stand as dark plum bars farther out ──
        if (withClouds) {
            If(e.lessThan(0.46), () => {
                const cu = vec2(az.mul(1.9).add(u.time.mul(0.003)), e.mul(30.0));
                const n = ndFbm3(cu);
                const layer = smoothstep(0.05, 0.11, e).mul(float(1.0).sub(smoothstep(0.26, 0.44, e)));
                // Thinner over the disc itself, so the sun keeps its clean silhouette.
                const dens = smoothstep(0.5, 0.72, n).mul(layer).mul(mix(float(1.0), float(0.4), discMask))
                    .toVar();
                const lit = clamp(wide.mul(2.2).add(core.mul(1.2)).add(0.12), 0.0, 1.0);
                const shade = mix(rgb(0x241040), rgb(0x4a1658), sa);
                const glowCol = mix(rgb(0xff3f86, 1.2), rgb(0xffa868, 1.9), clamp(core.mul(1.6), 0.0, 1.0));
                // Thin edges catch the light (forward scattering through the cloud's fringe).
                const fringe = dens.mul(float(1.0).sub(dens)).mul(4.0);
                const cloudCol = mix(shade, glowCol, clamp(lit.mul(0.5).add(fringe.mul(lit).mul(0.8)), 0.0, 1.0));
                col.assign(mix(col, cloudCol, dens.mul(0.85)));
            });
        }

        // ── Hologram halos: three pixel-thin dashed circles racing out of the sun's rim, with
        // a faint glow behind them (line clears, big combos, level up) ──
        const theta = atan(ly, lx);
        const thin = max(fwR.mul(1.3), 0.01);
        const holo = (P, segs, spin) => {
            const lineAt = (R, a) => {
                const d = r.sub(R).div(thin);
                return exp(d.mul(d).negate()).mul(a);
            };
            const lines = lineAt(P.x, 1.0).add(lineAt(P.x.mul(1.07), 0.55)).add(lineAt(P.x.mul(1.14), 0.3));
            const dash = smoothstep(0.3, 0.42, fract(theta.mul(segs / 6.2832).add(P.x.mul(spin))));
            return lines.mul(mix(float(0.2), float(1.0), dash)).add(ringTerm(r, P).mul(0.12)).mul(P.z);
        };
        // Event layers run only while an event is live: a uniform branch, so the whole draw
        // takes the same side and the idle sky skips them.
        If(u.holo0.z.add(u.holo1.z).greaterThan(0.0), () => {
            const rings = rgb(0x39f0ff, 2.4).mul(holo(u.holo0, 48.0, 0.25))
                .add(rgb(0xff5ad8, 2.4).mul(holo(u.holo1, 36.0, -0.25)));
            col.addAssign(rings.mul(facing).mul(above));
        });

        // ── Shooting stars (combos) ──
        If(min(u.shoot0.w, u.shoot1.w).lessThan(1.0), () => {
            const stars = shootingStar(az, e, u.shoot0, fwA).add(shootingStar(az, e, u.shoot1, fwA));
            col.addAssign(rgb(0xd8f4ff, 3.0).mul(min(stars, 1.0)).mul(above));
        });

        return mix(ndHazeColor(sa), col, above);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDuskSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}
