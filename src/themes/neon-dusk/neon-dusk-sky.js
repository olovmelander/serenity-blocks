/**
 * Neon Dusk — the sky dome: dusk gradient, the great setting sun, stratus bars burning across
 * it, twinkling stars, and the event layers (hologram rings out of the sun, shooting stars).
 *
 * One draw, a function of the view direction only. Drawn AFTER the opaque mountains and floor
 * with the depth test on, so early-Z rejects every pixel they already cover. The glass floor's
 * reflector renders this same dome from the mirrored camera, so the sun, the clouds and the rings
 * all appear in the floor for free.
 *
 * The sun is drawn in the lens's image plane (ndSunDisc), so it stays a circle when the yaw puts
 * it near the frame's edge, and its face is authored saturated and only a little above 1: an
 * orange whose green is high, or a disc far above the tone curve's shoulder, comes out pale peach.
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
    pow,
    sin,
    smoothstep,
    step,
    vec2,
} from 'three/tsl';
import {
    ndHash21,
    ndHash22,
    ndHazeColor,
    ndNoise2,
    ndSkyGradient,
    ndSunAlign,
    ndSunDisc,
    rgb,
} from './neon-dusk-tsl.js';

/** Sky dome radius: beyond everything it must sit behind, inside RIG.far. */
export const SKY_RADIUS = 6000;

/**
 * The sun's face colour for a vertical position v on the disc (−1 bottom … 1 top): a pale gold
 * crown, gold, molten orange, red-orange and hot magenta at the base. The gradient runs over the
 * part of the disc that clears the pass (v ≳ −0.6). Saturated, with the green low, and only a
 * little above 1, so the tone curve keeps its colour.
 */
export const ndSunColor = /* @__PURE__ */ Fn(([v]) => {
    const t = clamp(v.add(0.62).div(1.62), 0.0, 1.0);
    const c = mix(rgb(0xff1872, 1.2), rgb(0xff3a24, 1.25), smoothstep(0.02, 0.3, t)).toVar();
    c.assign(mix(c, rgb(0xff7a14, 1.35), smoothstep(0.26, 0.55, t)));
    c.assign(mix(c, rgb(0xffc632, 1.5), smoothstep(0.52, 0.82, t)));
    c.assign(mix(c, rgb(0xffeb98, 1.7), smoothstep(0.84, 1.0, t)));
    return c;
}).setLayout({ name: 'nd_sunColor', type: 'vec3', inputs: [{ name: 'v', type: 'float' }] });

/**
 * The sun's slits: open bands across the lower face, widening toward the base and sliding slowly
 * down it. `v` = vertical position on the disc, `fw` = its pixel footprint. 1 = face, 0 = slit.
 */
export const SLITS = Object.freeze({
    top: 0.34, period: 0.16, widest: 0.6, speed: 0.07,
});
export const ndSunSlits = (v, fw, time) => {
    const k = 1 / SLITS.period;
    const open = clamp(float(SLITS.top).sub(v).div(SLITS.top + 0.62), 0.0, 1.0);
    const gap = pow(open, 0.85).mul(SLITS.widest);
    const stripe = fract(v.mul(k).add(time.mul(SLITS.speed)));
    const fs = max(fw.mul(k), 1e-4);
    const face = smoothstep(gap.sub(fs), gap.add(fs), stripe);
    return mix(float(1.0), face, step(0.002, gap));
};

/** Gaussian ring at r for slot P = (radius, 1/width, energy, 0). */
const ringTerm = (r, P) => {
    const d = r.sub(P.x).mul(P.y);
    return exp(d.mul(d).negate()).mul(P.z);
};

/**
 * Stratus bars, low to high: elevation (rad), half-thickness (rad), how often a bar breaks along
 * its length (per rad of azimuth), a seed, a drift (rad/s), how much of its length is cloud
 * (the presence threshold: higher = shorter, sparser lenses), and the bearing (rad from the
 * sun's) and reach its streaks gather round: each bar leans to its own side, so together they
 * stagger across the sun instead of ringing it. The low ones cross the slits, the high ones the
 * sun's crown.
 */
export const STRATUS = Object.freeze([
    {
        e: 0.03, w: 0.0032, f: 2.7, seed: 1.7, drift: 0.0016, cover: 0.44, off: -0.22, reach: 0.36,
    },
    {
        e: 0.056, w: 0.0046, f: 2.1, seed: 4.1, drift: -0.0011, cover: 0.5, off: 0.3, reach: 0.3,
    },
    {
        e: 0.092, w: 0.0058, f: 1.7, seed: 8.3, drift: 0.0013, cover: 0.47, off: -0.06, reach: 0.42,
    },
    {
        e: 0.138, w: 0.0072, f: 1.35, seed: 2.9, drift: -0.0009, cover: 0.53, off: 0.34, reach: 0.3,
    },
    {
        e: 0.2, w: 0.0088, f: 1.1, seed: 6.6, drift: 0.0007, cover: 0.58, off: -0.32, reach: 0.38,
    },
]);

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
        // Footprints up front: fwidth needs uniform control flow.
        const fwA = max(fwidth(az), 1e-5).toVar();
        const fwE = max(fwidth(e), 1e-6).toVar();
        const col = ndSkyGradient(e, sa).toVar();

        // World angle from the sun (the broad glows) and the disc in the image plane (the face,
        // its slits, the halo hugging its rim and the hologram rings: round on screen).
        const lx = dot(dir, u.sunRight).toVar();
        const ly = dot(dir, u.sunUp).toVar();
        const facing = step(0.0, dot(dir, u.sunDir)).toVar();
        const ang = length(vec2(lx, ly)).toVar();
        const sd = ndSunDisc(u, dir).toVar();
        const r = length(sd).toVar();
        const v = sd.y.toVar();
        const fwR = max(fwidth(r), 1e-5).toVar();
        const fwV = max(fwidth(v), 1e-5).toVar();
        const above = smoothstep(-0.002, 0.0008, e).toVar();
        const pulse = u.sunPulse;

        // ── Stars: hashed cells in sky coordinates, fading out toward the warm horizon ──
        if (starDensity > 0) {
            const fadeIn = smoothstep(0.08, 0.34, e).mul(float(1.0).sub(sa.mul(0.65))).toVar();
            const sp = vec2(az.mul(95.0), e.mul(95.0));
            const fwS = max(fwA, fwE).mul(95.0);
            const cell = floor(sp);
            const h = ndHash22(cell);
            const present = step(1.0 - 0.18 * starDensity, ndHash21(cell.add(7.3)));
            const d = length(fract(sp).sub(h.mul(0.8).add(0.1)));
            const size = max(fwS.mul(0.9), 0.05);
            const core = float(1.0).sub(smoothstep(size.mul(0.4), size, d));
            const twinkle = sin(u.time.mul(h.x.mul(3.0).add(1.2)).add(h.y.mul(40.0))).mul(0.35).add(0.65);
            const bright = h.y.mul(h.y).mul(1.4).add(0.2);
            col.addAssign(mix(rgb(0xbfd4ff), rgb(0xffc8f0), h.x).mul(core.mul(present).mul(twinkle)
                .mul(bright)
                .mul(fadeIn)));
            // A sparse layer of bright stars, each with a faint four-point flare.
            const bp = vec2(az.mul(23.0), e.mul(23.0));
            const fwB = max(fwA, fwE).mul(23.0);
            const bCell = floor(bp);
            const bh = ndHash22(bCell.add(31.7));
            const bPresent = step(0.9, ndHash21(bCell.add(3.1)));
            const bq = fract(bp).sub(bh.mul(0.7).add(0.15));
            const bd = length(bq);
            const bSize = max(fwB.mul(1.1), 0.012);
            const bCore = float(1.0).sub(smoothstep(bSize.mul(0.3), bSize, bd));
            const flare = exp(abs(bq.x).div(bSize).mul(-1.4)).mul(exp(abs(bq.y).div(fwB).mul(-1.2)))
                .add(exp(abs(bq.y).div(bSize).mul(-1.4)).mul(exp(abs(bq.x).div(fwB).mul(-1.2))))
                .mul(0.35);
            const bTwinkle = sin(u.time.mul(bh.x.mul(1.7).add(0.6)).add(bh.y.mul(30.0))).mul(0.25).add(0.75);
            col.addAssign(mix(rgb(0xd8e6ff, 1.6), rgb(0xffd8f4, 1.5), bh.y).mul(bCore.add(flare))
                .mul(bPresent).mul(bTwinkle)
                .mul(fadeIn));
        }

        // ── Glow: a broad magenta air round the sun, a warm halo hugging the rim, and a band
        // of light along the horizon. Inside the disc the halo is dim, so the slits show the
        // dusk behind the sun instead of more glare ──
        const inside = float(1.0).sub(smoothstep(0.92, 1.06, r));
        const wide = exp(ang.mul(-3.4)).mul(float(0.16).add(pulse.mul(0.3))).mul(facing).toVar();
        const halo = exp(max(r.sub(1.0), 0.0).mul(-2.6)).mul(float(0.42).add(pulse.mul(0.6)))
            .mul(mix(float(1.0), float(0.3), inside)).mul(facing)
            .toVar();
        const band = exp(abs(e).mul(-30.0)).mul(exp(abs(lx).mul(-1.8))).mul(0.5).mul(facing);
        col.addAssign(rgb(0xff2a7a).mul(wide).add(rgb(0xff6a2e).mul(halo)).add(rgb(0xff5a5e).mul(band)));

        // ── The sun: a banded gradient disc, its slits widening toward the base ──
        const discMask = float(1.0).sub(smoothstep(float(1.0).sub(fwR), float(1.0).add(fwR), r))
            .mul(facing).mul(above)
            .toVar();
        const slit = ndSunSlits(v, fwV, u.time);
        const sunCol = ndSunColor(v).mul(float(1.0).add(pulse.mul(0.45))).toVar();
        col.assign(mix(col, sunCol, discMask.mul(slit)));

        // ── Stratus bars: thin lenses of cloud lying along the horizon, broken along their
        // length, their undersides lit from the sun below them: gold over the sun, hot pink
        // beside it, dark plum bars against the dusk farther out. Over the disc they burn ──
        if (withClouds) {
            If(e.lessThan(0.26), () => {
                const near = clamp(exp(ang.mul(-2.2)).mul(1.15), 0.0, 1.0);
                const litCol = mix(
                    rgb(0xb02a6a, 0.5),
                    mix(rgb(0xff3f7c, 1.0), rgb(0xffa040, 1.45), smoothstep(0.6, 0.95, near)),
                    smoothstep(0.08, 0.55, near),
                );
                const shadeCol = mix(rgb(0x1c0b30), rgb(0x3c1240), near);
                // Across the disc a bar stands in FRONT of the sun: it dims the face it covers and
                // glows at its rims, so it reads as cloud, not as a ring passing behind.
                const veil = sunCol.mul(0.42).add(litCol.mul(0.25));
                const gather0 = smoothstep(0.14, 0.6, near);
                for (const bar of STRATUS) {
                    const lean = az.sub(bar.off).div(bar.reach);
                    const gather = gather0.mul(exp(lean.mul(lean).negate()));
                    const a = az.mul(bar.f).add(u.time.mul(bar.drift * bar.f)).add(bar.seed);
                    const n1 = ndNoise2(vec2(a, bar.seed * 3.1));
                    const n2 = ndNoise2(vec2(a.mul(4.7), bar.seed * 5.3 + 11.0));
                    // Each lens tapers to a point at both ends and swells and thins along its run;
                    // the bars gather round the sun and thin out away from it.
                    const presence = smoothstep(bar.cover, bar.cover + 0.3, n1).mul(gather);
                    // The bar wanders up and down along its run (a lens of cloud, not a rule).
                    const centre = n2.sub(0.5).mul(bar.w * 2.6).add(n1.sub(0.5).mul(0.02)).add(bar.e);
                    const halfW = max(pow(presence, 0.7).mul(n2.mul(0.9).add(0.55)).mul(bar.w), 1e-5);
                    const q = e.sub(centre).div(halfW);
                    const fq = fwE.div(halfW);
                    // Soft through the body, a clean (pixel-wide) edge at the rim.
                    const dens = float(1.0).sub(smoothstep(float(0.3), float(1.0).add(fq), abs(q)))
                        .mul(step(1e-4, presence));
                    const under = smoothstep(0.55, -0.85, q);
                    const lit = clamp(under.mul(near.mul(0.75).add(0.25)).add(0.06), 0.0, 1.0);
                    const rimLit = smoothstep(0.35, 0.95, abs(q));
                    const overSun = mix(veil, sunCol.mul(1.1), rimLit.mul(0.6));
                    const cloudCol = mix(mix(shadeCol, litCol, lit), overSun, discMask);
                    col.assign(mix(col, cloudCol, dens.mul(gather).mul(0.88)));
                }
            });
        }

        // ── Hologram halos: three pixel-thin dashed circles racing out of the sun's rim, with
        // a faint glow behind them (line clears, big combos, level up) ──
        const theta = atan(sd.y, sd.x);
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

        // ── Shooting stars (combos, and now and then at rest) ──
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
