import {
    abs, atan, clamp, dot, exp, float, floor, fract, max, mix, select, sin, smoothstep, texture, vec2, vec3,
} from 'three/tsl';

// The upper atmosphere moves on a different clock from the four-minute eclipse.
// Each entry controls the red airglow, cirrus opacity, violet skylight and stellar visibility.
const AIRS = [
    [0.35, 0.20, 0.30, 0.86],
    [1.00, 0.48, 0.12, 0.65],
    [0.08, 0.06, 1.00, 1.30],
    [0.57, 0.86, 0.50, 0.72],
];

export function sampleNightAir(time, target) {
    const cycle = Number.isFinite(time) ? time / 47 : 0;
    const phase = ((cycle % AIRS.length) + AIRS.length) % AIRS.length;
    const index = Math.floor(phase);
    const f = phase - index;
    const k = f * f * (3 - 2 * f);
    const a = AIRS[index];
    const b = AIRS[(index + 1) % AIRS.length];
    target.set(
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        a[2] + (b[2] - a[2]) * k,
        a[3] + (b[3] - a[3]) * k,
    );
}

// Stars sit inside their own projected cells; even a bright star's core clears the cell edge.
// The cube faces keep a bounded projection when the celestial pole wheels through the frame.
export function starField(q, U, fine) {
    const a = abs(q).toVar();
    const face = select(
        a.z.greaterThanEqual(max(a.x, a.y)),
        q.xy,
        select(a.x.greaterThan(a.y), q.zy, q.xz),
    ).div(max(max(a.x, a.y), a.z));
    const scale = fine ? 122 : 46;
    const p = face.mul(scale).add(fine ? 113.6 : 15.7).toVar();
    const cell = floor(p).add(512).toVar();
    const h = fract(sin(vec3(
        dot(cell, vec2(41.31, 17.27)),
        dot(cell, vec2(19.91, 63.17)),
        dot(cell, vec2(73.13, 27.91)),
    )).mul(43758.54)).toVar();
    const off = fract(p).sub(h.xy.mul(0.62).add(0.19)).toVar();
    const energy = h.z.pow(fine ? 7 : 13).toVar();
    const radius = max(U.texel.mul(scale * 0.68), energy.mul(fine ? 0.035 : 0.027).add(0.023)).toVar();
    const dd = dot(off, off).div(radius.mul(radius)).toVar();
    const light = exp(dd.negate()).add(exp(dd.mul(-0.16)).mul(fine ? 0.028 : 0.075));
    const tint = mix(vec3(0.61, 0.77, 1), vec3(1, 0.68, 0.50), h.x).toVar();
    const twinkle = sin(U.time.mul(h.x.add(0.65)).add(h.y.mul(52))).mul(0.09).add(0.91);
    return tint.mul(light).mul(energy).mul(twinkle).mul(fine ? 0.33 : 2.5);
}

/** Put the rift over the volcano in a wide view, or in the open sky left of the portrait moon. */
export function placeGalacticRift(aspect, U) {
    const wide = Math.max(0, Math.min(1, (aspect - 0.68) / 0.94));
    const foot = -0.16 + wide * 0.78;
    const top = 0.095 - wide * 0.645;
    const a = U.galaxyFoot.value.set(Math.sin(foot), 0.02, -Math.cos(foot)).normalize();
    const b = U.galaxyAlong.value.set(Math.cos(0.95) * Math.sin(top), Math.sin(0.95), -Math.cos(0.95) * Math.cos(top));
    const pole = U.galaxyPole.value.crossVectors(a, b).normalize();
    b.crossVectors(pole, a).normalize();
}

/** Angular coordinates on the galactic plane. Its dust lanes and faint clusters share one mip chain. */
export function galacticRift(q, map, U) {
    const along = atan(dot(q, U.galaxyAlong), dot(q, U.galaxyFoot));
    const off = dot(q, U.galaxyPole);
    const st = vec2(float(0.92).sub(along.mul(0.68)), off.mul(1.65).add(0.5)).toVar();
    const fade = smoothstep(0, 0.10, st.x).mul(smoothstep(0, 0.10, float(1).sub(st.x)))
        .mul(smoothstep(0, 0.12, st.y)).mul(smoothstep(0, 0.12, float(1).sub(st.y)));
    return texture(map, st).rgb.mul(fade).mul(vec3(0.225, 0.244, 0.33));
}

/** Airglow behind the hills and two heights of wind-streaked cirrus, sampled in the mirrored sky too. */
export function nightAtmosphere(U, clouds, az, el, toMoon, detailed) {
    const air = U.nightAir;
    const azimuth = az.toVar();
    const rise = el.toVar();
    const drift = U.time.mul(0.009);
    const warp = sin(azimuth.mul(3.8).add(drift)).mul(0.021);
    const st = vec2(azimuth.mul(0.58).add(drift.mul(0.31)), rise.add(warp).mul(3.7).sub(drift.mul(0.12)));
    const wisps = texture(clouds, st).r.toVar();
    const threads = detailed ? texture(clouds, st.mul(vec2(1.85, 1.54)).add(vec2(0.27, 0.61))).r : wisps;
    const cloud = clamp(wisps.mul(1.8).add(threads.mul(0.65)).sub(0.08), 0, 1).toVar();
    const banks = exp(rise.sub(0.12).pow2().mul(-39)).add(0.19);
    const density = cloud.mul(banks).mul(air.y).toVar();
    const lunarScatter = exp(toMoon.sub(1).mul(6)).toVar();
    const glowHeight = rise.sub(warp).sub(sin(azimuth.mul(6.8).sub(drift)).mul(0.008)).sub(0.115);
    const veil = exp(glowHeight.mul(glowHeight).mul(-98)).toVar();
    const red = vec3(0.125, 0.009, 0.022).mul(air.x).mul(veil)
        .mul(wisps.mul(1.6).add(0.35))
        .mul(lunarScatter.mul(0.45).add(0.55));
    const cirrus = mix(vec3(0.030, 0.013, 0.052), vec3(0.29, 0.045, 0.064), lunarScatter)
        .mul(density).mul(air.x.mul(0.7).add(0.7));
    // Ice crystals in the thickest veil pick out arcs of a 22-degree lunar halo.
    // A red inner edge gives way to a broader pearl band. Gaps follow the moving ice.
    const distance = toMoon.sub(Math.cos(22 * (Math.PI / 180))).toVar();
    const inner = exp(distance.sub(0.002).mul(215).pow2().negate());
    const outer = exp(distance.add(0.004).mul(95).pow2().negate());
    const arc = vec3(0.095, 0.019, 0.023).mul(inner).add(vec3(0.045, 0.033, 0.055).mul(outer))
        .mul(smoothstep(0.34, 0.80, air.y))
        .mul(cloud.mul(1.9).add(0.2));
    return { light: red.add(cirrus).add(arc).mul(U.exposure), transmission: float(1).sub(density.mul(0.68)) };
}
