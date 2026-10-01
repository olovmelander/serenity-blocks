/**
 * Synthwave Sunset — the sky dome: ONE draw for the gradient, the sun, its glow, the cloud
 * streaks, the stars and the shooting stars.
 *
 * Everything is a function of the view direction, so the dome's radius and tessellation do not
 * matter; it only has to surround the camera. The sun is the classic slit disc: a yellow→orange→
 * magenta ramp whose lower half is cut by horizontal slits that thicken toward the horizon and
 * scroll slowly downward. Thin stratus streaks cross in front of it; the parts of a streak near
 * the sun catch a silver lining. Stars are procedural (one hashed cell grid in azimuth/elevation,
 * sized in pixels via fwidth), so they are crisp at any resolution and cost no vertices.
 *
 * Replaces the old theme's sun sphere + six additive glow planes + three haze planes + a star
 * Points cloud (which WebGPU drew as 1-pixel dots: Points ignore sizeNode on that backend).
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
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    rgb,
    swFbm2,
    swFbm3,
    swHash21,
    swHash22,
    swHazeColor,
    swSkyGradient,
    swSunAlign,
} from './synthwave-sunset-tsl.js';

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** Sky dome radius: beyond the floor's far edge, inside RIG.far. */
export const SKY_RADIUS = 5000;

/**
 * The sun's colour ramp over its local vertical coordinate ly ∈ [−1, 1] (bottom → top), in HDR:
 * the top is a pale gold that blooms hardest, the base a hot magenta.
 */
export const swSunColor = /* @__PURE__ */ Fn(([ly]) => {
    const c = rgb(0xff1f86).toVar();
    c.assign(mix(c, rgb(0xff3464), smoothstep(-1.0, -0.4, ly)));
    c.assign(mix(c, rgb(0xff7426), smoothstep(-0.5, 0.12, ly)));
    c.assign(mix(c, rgb(0xffb52e), smoothstep(0.05, 0.6, ly)));
    c.assign(mix(c, rgb(0xffe27a), smoothstep(0.55, 1.0, ly)));
    return c.mul(mix(float(1.05), float(1.75), smoothstep(-1.0, 1.0, ly)));
}).setLayout({ name: 'sw_sunColor', type: 'vec3', inputs: [{ name: 'ly', type: 'float' }] });

/** Slit period, in sun-radius units of local height (≈ 1.6° at the authored sun size). */
export const SUN_SLIT_FREQ = 5.4;

/**
 * The slit mask (1 = inside a slit) at local height ly. Slits start as hairlines just above the
 * centre and thicken toward the part of the disc the ridge leaves visible (ly ≈ −0.45), and
 * scroll slowly downward, so each slit widens as it sinks. `fw` = fwidth of the slit phase,
 * measured by the caller (derivatives stay in the caller's uniform control flow). The slit is
 * centred at phase 0.5, so the fract() wrap never lands on an edge.
 */
export const swSunSlits = /* @__PURE__ */ Fn(([ly, t, fw]) => {
    const phase = ly.sub(t.mul(0.03)).mul(SUN_SLIT_FREQ);
    const f = fract(phase);
    const gap = float(1.0).sub(smoothstep(-0.5, 0.45, ly)).mul(0.6);
    const half = gap.mul(0.5);
    const d = abs(f.sub(0.5));
    const inGap = float(1.0).sub(smoothstep(half.sub(fw), half.add(fw), d));
    return inGap.mul(clamp(half.div(max(fw, 1e-4)), 0.0, 1.0));
}).setLayout({
    name: 'sw_sunSlits',
    type: 'float',
    inputs: [{ name: 'ly', type: 'float' }, { name: 't', type: 'float' }, { name: 'fw', type: 'float' }],
});

/**
 * One shooting star in (azimuth, elevation) space. A = (az0, e0, vAz, vE) [rad, rad/s],
 * B = (age s, tail length rad, intensity, 0). Returns the streak intensity at p; the tail fades
 * quadratically toward its end. `pxRad` = radians per pixel.
 */
const swShootingStar = /* @__PURE__ */ Fn(([p, A, B, pxRad]) => {
    const head = A.xy.add(A.zw.mul(B.x));
    const dirV = normalize(A.zw.add(vec2(1e-5, 0.0)));
    const tail = head.sub(dirV.mul(B.y));
    const pa = p.sub(tail);
    const ba = head.sub(tail);
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0.0, 1.0);
    const dPx = length(pa.sub(ba.mul(h))).div(pxRad);
    return exp(dPx.mul(dPx).mul(-0.5)).mul(h.mul(h)).mul(B.z);
}).setLayout({
    name: 'sw_shootingStar',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' },
        { name: 'A', type: 'vec4' },
        { name: 'B', type: 'vec4' },
        { name: 'pxRad', type: 'float' },
    ],
});

/**
 * @param {object} u       shared world uniforms (see createWorldUniforms)
 * @param {object} [opts]
 * @param {number} [opts.cloudOctaves=3]  0 = no clouds, 2 or 3
 * @param {boolean} [opts.stars=true]
 * @param {boolean} [opts.shootingStars=true]
 */
export function createSky(u, opts = {}) {
    const cloudOctaves = opts.cloudOctaves ?? 3;
    const withStars = opts.stars !== false;
    const withShooting = opts.shootingStars !== false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveSky';
    material.side = THREE.BackSide;
    // Drawn AFTER the opaque world with the depth test on (see renderOrder below): early-Z
    // rejects every pixel the floor, skyline and palms already cover, so the sky's shading runs
    // only where sky is actually visible (about half the screen).
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    material.colorNode = Fn(() => {
        // Everything a branch below reads is a root-level var, and every derivative is taken
        // here, in uniform control flow (WGSL rejects fwidth inside a non-uniform branch).
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const e = dir.y.toVar();
        const hLen = max(length(vec2(dir.x, dir.z)), 1e-4);
        const sa = swSunAlign(dir.z.div(hLen)).toVar();
        const col = swSkyGradient(e, sa).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();
        const pxRad = max(fwidth(e), 1e-5).toVar();
        const fwAz = fwidth(az).toVar();

        // -- Sun frame: local coordinates in sun radii --
        const lx = dot(dir, u.sunRight).div(u.sunRadius).toVar();
        const ly = dot(dir, u.sunUp).div(u.sunRadius).toVar();
        const fwLy = fwidth(ly).toVar();
        const facing = step(0.0, dot(dir, u.sunDir));
        const r = length(vec2(lx, ly)).toVar();
        // The floor hides everything below the horizon; this only anti-aliases the seam.
        const above = smoothstep(-0.0015, 0.0006, e).toVar();

        // -- Disc coverage --
        const fwR = max(fwidth(r), 1e-4);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(fwR), float(1.0).add(fwR), r))
            .mul(facing).mul(above)
            .toVar();

        // -- Glow: a wide bloom, a tight halo, and a flare hugging the horizon --
        // The glow lives outside the disc: through the slits the darker sky itself shows, which
        // is what makes the slits read.
        const pulse = u.sunPulse;
        const outside = smoothstep(0.9, 1.02, r);
        const behind = float(1.0).sub(disc.mul(0.8));
        const wide = exp(r.mul(-0.55)).mul(float(0.3).add(pulse.mul(0.45))).mul(facing).toVar();
        const halo = exp(max(r.sub(1.0), 0.0).mul(-3.6)).mul(float(0.5).add(pulse.mul(0.9))).mul(facing).mul(outside)
            .toVar();
        const band = exp(abs(e).mul(-34.0)).mul(exp(abs(lx).mul(-0.34))).mul(0.62).mul(facing);
        col.addAssign(rgb(0xff2f78).mul(wide).add(rgb(0xff9860).mul(band)).mul(behind)
            .add(rgb(0xff7a4c).mul(halo)));

        // -- Disc + slits (only where the disc is) --
        If(disc.greaterThan(0.0005), () => {
            const slits = swSunSlits(ly, u.time, fwLy.mul(SUN_SLIT_FREQ));
            const sunAmount = disc.mul(float(1.0).sub(slits));
            // Seen through a slit, the sky is dusky violet: the contrast is what makes a slit read.
            const dusk = mix(col, rgb(0x3a0f52), disc.mul(0.72));
            col.assign(mix(dusk, swSunColor(ly).mul(float(1.0).add(pulse.mul(0.3))), sunAmount));
        });

        // -- Stratus streaks: elongated value fbm in (azimuth, elevation), low in the sky --
        const cloud = float(0.0).toVar();
        if (cloudOctaves > 0) {
            If(e.greaterThan(0.012).and(e.lessThan(0.25)), () => {
                const env = smoothstep(0.012, 0.05, e).mul(float(1.0).sub(smoothstep(0.12, 0.25, e)));
                const cc = vec2(az.mul(2.3).add(u.time.mul(0.0035)), e.mul(31.0));
                const n = cloudOctaves >= 3 ? swFbm3(cc) : swFbm2(cc);
                cloud.assign(smoothstep(0.5, 0.78, n).mul(env));
                const lit = clamp(wide.add(halo.mul(0.9)), 0.0, 1.6);
                const thin = float(1.0).sub(smoothstep(0.06, 0.5, cloud));
                const cloudCol = rgb(0x2b0b42).mul(float(0.5).add(sa.mul(0.5)))
                    .add(rgb(0xff9868).mul(lit.mul(thin).mul(1.5)))
                    .add(swHazeColor(sa).mul(float(1.0).sub(smoothstep(0.02, 0.12, e)).mul(0.3)));
                col.assign(mix(col, cloudCol, cloud.mul(0.93)));
            });
        }

        // -- Stars: one hashed cell per ~0.5 deg, most faint, a few bright (upper sky only) --
        if (withStars) {
            const cellsPerPx = max(max(fwAz, pxRad).mul(118.0), 1e-4).toVar();
            If(e.greaterThan(0.1), () => {
                const sc = vec2(az.mul(118.0), e.mul(118.0));
                const cell = floor(sc);
                const f = fract(sc);
                const h = swHash21(cell);
                const pos = swHash22(cell.add(7.13)).mul(0.7).add(0.15);
                const dPx = length(f.sub(pos)).div(cellsPerPx);
                const mag = clamp(h.sub(0.95).div(0.05), 0.0, 1.0);
                const radiusPx = float(0.45).add(mag.mul(0.75));
                const core = float(1.0).sub(smoothstep(radiusPx.sub(0.55), radiusPx.add(0.55), dPx)).mul(step(0.95, h));
                const twinkle = sin(u.time.mul(float(1.3).add(h.mul(2.7))).add(h.mul(91.0))).mul(0.35).add(0.65);
                const starI = core.mul(float(0.16).add(pow(mag, 3.0).mul(1.7))).mul(twinkle);
                const vis = smoothstep(0.1, 0.34, e)
                    .mul(float(1.0).sub(cloud))
                    .mul(float(1.0).sub(smoothstep(0.08, 0.45, dot(col, LUMA))));
                const tint = mix(rgb(0xbcd4ff), rgb(0xffd8f2), swHash21(cell.add(3.1)));
                col.addAssign(tint.mul(starI.mul(vis)));
            });
        }

        // -- Shooting stars (two slots; a uniform branch skips them while none is live) --
        if (withShooting) {
            If(u.shoot0B.z.add(u.shoot1B.z).greaterThan(0.0), () => {
                const p = vec2(az, e);
                const s = swShootingStar(p, u.shoot0A, u.shoot0B, pxRad)
                    .add(swShootingStar(p, u.shoot1A, u.shoot1B, pxRad));
                col.addAssign(rgb(0xdcecff, 3.2).mul(s.mul(float(1.0).sub(cloud.mul(0.8)))));
            });
        }

        // -- The horizon line: a hairline of light where the floor meets the sky --
        const hl = exp(abs(e).mul(-420.0)).mul(float(0.45).add(sa.mul(1.2)).add(u.horizonFlash.mul(2.2)));
        col.addAssign(mix(rgb(0xff6f8e), rgb(0xffc79a), sa).mul(hl));

        return mix(swHazeColor(sa), col, above);
    })();

    // Radius inside the camera's far plane and beyond everything it must sit behind (the floor
    // runs ~3400 units out); renderOrder puts it after the opaque world.
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}
