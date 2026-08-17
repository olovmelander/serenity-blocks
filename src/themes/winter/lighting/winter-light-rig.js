/**
 * Winter polar-twilight light rig + shared snow-shading TSL helpers.
 *
 * The single source of truth for the Winter theme's lighting after the
 * snowflow-level rebuild (docs/WINTER_SNOWFLOW_MASTERPLAN_2026-08.md).
 * Grade locked 2026-08-13: POLAR TWILIGHT — the sun sits just below the
 * horizon behind the mountain line; its warm glow band is the raking key,
 * the moon is the cool counter-light and the glint driver, the aurora is a
 * live animated ambient term.
 *
 * The BRDF/noise helpers are ports of snowflow_demo (MIT,
 * github.com/Noniv/snowflow_demo — lib/noise.wgsl, lib/shading.wgsl),
 * proven in src/playground/effects/winter-snowlab.effect.js. Everything here
 * is a pure node-builder: no scene objects, no uniforms of its own.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    cross,
    float,
    max,
    mix,
    normalize,
    pow,
    step,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';

// ---------------------------------------------------------------- rig values
/** Compass bearing of the sunk sun — the warm band sits behind the peaks,
 *  left of frame centre (the camera looks toward -z). */
export const TWILIGHT_AZIMUTH = (207 * Math.PI) / 180;
/** The glow band's effective key elevation — the glow centroid, NOT a disc. */
export const TWILIGHT_ELEVATION = (5.5 * Math.PI) / 180;

export const TWILIGHT_DIR = new THREE.Vector3(
    Math.sin(TWILIGHT_AZIMUTH) * Math.cos(TWILIGHT_ELEVATION),
    Math.sin(TWILIGHT_ELEVATION),
    Math.cos(TWILIGHT_AZIMUTH) * Math.cos(TWILIGHT_ELEVATION),
).normalize();

/** Warm twilight beam (≈1/2 the snowlab's; the theme grades in post). */
export const TWILIGHT_RADIANCE = new THREE.Color(1.55, 0.88, 0.40);
/** Cool moonlight — matches the wonderland MOON_POS placement. */
export const MOON_RADIANCE = new THREE.Color(0.30, 0.40, 0.58);
/** Warm horizon-band colour shared by the sky dome, fog in-scatter and any
 *  material that needs to "meet the sky at one colour". */
export const WARM_HORIZON = new THREE.Color(1.30, 0.52, 0.16);
/** Ambient hemisphere (night sky integral, NOT the visible zenith pixel). */
export const AMB_ZENITH = new THREE.Color(0.07, 0.16, 0.42);
export const AMB_HORIZON = new THREE.Color(0.10, 0.16, 0.30);
/** Aurora contribution to ambient at uIntensity = 1, from above. */
export const AURORA_AMBIENT = new THREE.Color(0.05, 0.21, 0.15);

// ── Aurora palette, by emission altitude ────────────────────────────────────
// Shared by the dome's shader AND the CPU ambient solve below, so the light the
// aurora CASTS can never drift from the light it visibly EMITS.
//   ~90-100 km  molecular N2   → pink/magenta hem
//   100-150 km  atomic O 557.7 → green body
//   200-400 km  atomic O 630.0 → crimson crown
//   low, hard   N2+ 427.8      → blue-violet
// The green body breathes between these two. The "warm" end used to carry
// 0.22 red, and red+green is YELLOW-green — user called it. Real 557.7 nm
// oxygen is a spectral line: essentially NO red in it. Both ends now hold the
// red channel near zero, so the breathing cycle runs pure-emerald ↔ teal-tinged
// emerald instead of mustard ↔ teal, and the higher saturation is what reads
// as "vibrant" once the emissive bloom picks it up.
export const AURORA_GREEN_WARM = new THREE.Color(0.04, 1.0, 0.26);
export const AURORA_GREEN_COOL = new THREE.Color(0.03, 1.0, 0.52);
/** Deep crimson — pushed off pink toward a truer 630 nm oxygen red. */
export const AURORA_CRIMSON = new THREE.Color(0.86, 0.055, 0.15);
export const AURORA_PINK = new THREE.Color(1.0, 0.32, 0.62);
export const AURORA_VIOLET = new THREE.Color(0.42, 0.42, 1.0);

/**
 * How energised the display is right now, 0..1.35. Mirrors the dome shader's
 * `activity` exactly — slow drift (periods ~3 and ~5 min) plus storm intensity
 * and combo flare, so a big clear genuinely energises the sky.
 */
export function auroraActivity(t, intensity = 0, flare = 0) {
    const i = Math.min(1.5, Math.max(0, intensity));
    // Only the EXCESS over the theme's resting intensity (~0.62) counts as a
    // storm — see the matching note in aurora-volume.js. Keep the two in step.
    return Math.min(1.35, Math.max(
        0,
        0.06
        + (Math.sin(t * 0.035) * 0.18)
        + (Math.sin((t * 0.0213) + 1.3) * 0.14)
        + (Math.max(0, i - 0.62) * 0.9)
        + (flare * 0.5),
    ));
}

/**
 * The aurora's ambient contribution — ONE shared uniform, written once per
 * frame and read by every surface the curtains light (snow, foxes).
 *
 * This is what makes the sky a light SOURCE rather than a backdrop: when the
 * display energises into its red-crown state, the snow itself blushes.
 */
export const uAuroraAmbient = uniform(new THREE.Color(0.028, 0.126, 0.045));

/** Re-solve `uAuroraAmbient` for this frame. Call once per frame, from update(). */
export function updateAuroraAmbient(t, intensity = 0, flare = 0) {
    const act = auroraActivity(t, intensity, flare);
    const c = uAuroraAmbient.value;
    c.copy(AURORA_GREEN_WARM).lerp(AURORA_GREEN_COOL, (Math.sin(t * 0.047) * 0.5) + 0.5);
    // The crown and hem occupy only part of the visible sky, so they tint the
    // GROUND far more gently than they tint the dome — otherwise a storm turns
    // the whole snowfield pink, which reads as a bug rather than as weather.
    c.lerp(AURORA_CRIMSON, Math.min(1, Math.max(0, (act - 0.10) * 2.1)) * 0.58);
    c.lerp(AURORA_PINK, Math.min(1, Math.max(0, (act - 0.34) * 1.7)) * 0.16);
    c.multiplyScalar(0.21 * (0.45 + (0.55 * Math.min(1, act))));
    return c;
}

/** Snow albedo band — high, narrow, slightly blue. NEVER 1.0. */
export const SNOW_ALBEDO = new THREE.Color(0.855, 0.885, 0.945);
export const SNOW_ALBEDO_COMPRESSED = new THREE.Color(0.62, 0.665, 0.755);
export const SNOW_ALBEDO_BERM = new THREE.Color(0.895, 0.92, 0.965);
/** Blue "snow cave" tint: light in a snow hollow scattered through snow. */
export const DEEP_TINT = new THREE.Color(0.55, 0.72, 1.0);

// ------------------------------------------------------- noise w/ derivatives
export const tslHash21 = Fn(([p]) => {
    const p3 = vec3(p.x, p.y, p.x).mul(0.1031).fract().toVar();
    p3.assign(p3.add(p3.dot(vec3(p3.y, p3.z, p3.x).add(33.33))));
    return p3.x.add(p3.y).mul(p3.z).fract();
});

export const tslHash22 = Fn(([p]) => {
    const p3 = vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973)).fract().toVar();
    p3.assign(p3.add(p3.dot(vec3(p3.y, p3.z, p3.x).add(33.33))));
    return vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(vec2(p3.z, p3.y)).fract();
});

export const tslGrad2 = Fn(([i]) => {
    const a = tslHash21(i).mul(6.28318530718);
    return vec2(a.cos(), a.sin());
});

/** Gradient noise with ANALYTIC derivatives: vec3(value, dH/dx, dH/dy). */
export const tslNoised = Fn(([p]) => {
    const i = p.floor();
    const f = p.sub(i);
    const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
    const du = f.mul(f).mul(30.0).mul(f.mul(f.sub(2.0)).add(1.0));
    const ga = tslGrad2(i);
    const gb = tslGrad2(i.add(vec2(1.0, 0.0)));
    const gc = tslGrad2(i.add(vec2(0.0, 1.0)));
    const gd = tslGrad2(i.add(vec2(1.0, 1.0)));
    const va = ga.dot(f);
    const vb = gb.dot(f.sub(vec2(1.0, 0.0)));
    const vc = gc.dot(f.sub(vec2(0.0, 1.0)));
    const vd = gd.dot(f.sub(vec2(1.0, 1.0)));
    const k1 = vb.sub(va);
    const k2 = vc.sub(va);
    const k3 = va.sub(vb).sub(vc).add(vd);
    const value = va.add(k1.mul(u.x)).add(k2.mul(u.y)).add(k3.mul(u.x).mul(u.y));
    const deriv = ga
        .add(gb.sub(ga).mul(u.x))
        .add(gc.sub(ga).mul(u.y))
        .add(ga.sub(gb).sub(gc).add(gd).mul(u.x)
            .mul(u.y))
        .add(du.mul(vec2(u.y, u.x).mul(k3).add(vec2(k1, k2))));
    return vec3(value, deriv.x, deriv.y);
});

/** Rotate a vec2 node by (c, s) — numbers or nodes. */
export const rotN = (p, c, s) => vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
/** Map a gradient back through that rotation (transpose). */
export const rotTN = (g, c, s) => vec2(g.x.mul(c).add(g.y.mul(s)), g.y.mul(c).sub(g.x.mul(s)));

/**
 * 3-octave ridged noise with derivatives (sharp crest, smooth trough —
 * sastrugi). JS-unrolled; octave rotations are numeric. Returns { h, g }.
 */
export function ridged3(q) {
    const LAC = 2.11;
    const GAIN = 0.52;
    const ROT = 0.717;
    let amp = 0.5;
    let freq = 1;
    let cAcc = 1;
    let sAcc = 0;
    let pcur = q;
    let sum = float(0.0);
    let grad = vec2(0.0, 0.0);
    let prev = float(1.0);
    for (let o = 0; o < 3; o += 1) {
        const n = tslNoised(pcur.mul(freq));
        const s = n.x.sign();
        const r = n.x.abs().oneMinus();
        const r2 = r.mul(r);
        const dr2 = r.mul(-2.0).mul(s);
        sum = sum.add(prev.mul(r2).mul(amp));
        const gOct = n.yz.mul(dr2).mul(amp).mul(prev).mul(freq);
        grad = grad.add(rotTN(gOct, cAcc, sAcc));
        prev = mix(float(1.0), r2, 0.65);
        amp *= GAIN;
        freq *= LAC;
        const c = Math.cos(ROT);
        const sj = Math.sin(ROT);
        pcur = rotN(pcur, c, sj);
        const cN = cAcc * c - sAcc * sj;
        sAcc = sAcc * c + cAcc * sj;
        cAcc = cN;
    }
    return { h: sum, g: grad };
}

// ------------------------------------------------------------ shading terms
/** Wrapped diffuse — w≈0.62 open snow, →0.15 compacted. */
export const wrapDiffuseN = (nl, w) => max(0.0, nl.add(w).div(w.add(1.0).mul(w.add(1.0))));

/**
 * Back-scatter subsurface lobe (the term that makes it read as snow).
 * Returns a scalar; multiply by light radiance × tint × albedo outside.
 */
export const backScatterN = (N, L, V, thickness) => {
    const H = normalize(L.add(N.mul(0.28)));
    const lobe = pow(clamp(V.dot(H.negate()), 0.0, 1.0), mix(3.0, 9.0, thickness));
    return lobe.mul(mix(1.0, 0.3, thickness));
};

/** Thickness-dependent SSS tint — deep snow comes back bluer. */
export const sssTintN = (thickness) => mix(
    vec3(0.94, 0.965, 1.0),
    vec3(DEEP_TINT.r, DEEP_TINT.g, DEEP_TINT.b),
    thickness,
);

/** GGX specular (D·V·F condensed) — DAMP on ridged normals or snow reads wet. */
export const ggxSpecN = (N, V, L, roughness, radiance) => {
    const H = normalize(V.add(L));
    const NdotH = clamp(N.dot(H), 0.0, 1.0);
    const nl = clamp(N.dot(L), 0.0, 1.0);
    const a = roughness.mul(roughness);
    const a2 = a.mul(a);
    const denom = NdotH.mul(NdotH).mul(a2.sub(1.0)).add(1.0);
    const D = a2.div(denom.mul(denom).mul(Math.PI).max(1e-6));
    const F = float(0.028).add(pow(clamp(V.dot(H), 0.0, 1.0).oneMinus(), 5.0).mul(0.97));
    return radiance.mul(D).mul(F).mul(nl).mul(0.25);
};

/**
 * Cell-hashed crystal-facet glint field (scalar). World-anchored, grazing-
 * gated, footprint-faded. `cellA/cellB` are in WORLD UNITS — scale by the
 * scene's units-per-metre (snowflow: 0.052 m and 0.185 m).
 */
export const glintFieldN = ({
    worldXZ, N, V, L, fp, cellA, cellB, octaves = 2,
}) => {
    const upG = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), step(0.95, N.y.abs()));
    const T = normalize(cross(upG, N));
    const B = cross(N, T);
    const H = normalize(V.add(L));
    const octave = (cell, sharpness, seed) => {
        const pc = worldXZ.add(seed);
        const id = pc.div(cell).floor();
        const r = tslHash22(id);
        const r2 = tslHash22(id.add(vec2(19.73, 7.31)));
        const occupied = step(r2.x, 0.62);
        const centre = id.add(0.5).add(r.sub(0.5).mul(0.72)).mul(cell);
        const dd = pc.sub(centre).length().div(cell * 0.17);
        const disc = dd.mul(dd).oneMinus().clamp(0.0, 1.0);
        const ang = r.y.mul(6.28318530718);
        const tilt = r2.y.mul(0.26).add(0.10);
        const facet = normalize(N.add(T.mul(ang.cos()).add(B.mul(ang.sin())).mul(tilt)));
        const nh = facet.dot(H).clamp(0.0, 1.0);
        return disc.mul(pow(nh, sharpness)).mul(occupied);
    };
    const NdotV = N.dot(V).clamp(0.0, 1.0);
    const graze = pow(NdotV.oneMinus(), 4.0);
    const nl = clamp(N.dot(L), 0.0, 1.0);
    const lightGate = mix(
        float(1.0),
        float(0.45),
        pow(nl, 2.0),
    ).mul(clamp(nl.mul(6.0), 0.0, 1.0));
    const fadeA = clamp(fp.div(cellA * 2.2).oneMinus(), 0.0, 1.0);
    const fadeB = clamp(fp.div(cellB * 2.2).oneMinus(), 0.0, 1.0);
    // Lower tiers keep the coarse octave (which carries the read) and drop the
    // fine one, whose cells alias out at distance anyway.
    let sum = octave(cellA, 780.0, vec2(0.0, 0.0)).mul(fadeA);
    if (octaves > 1) {
        sum = sum.add(octave(cellB, 1500.0, vec2(53.1, 17.9)).mul(1.35).mul(fadeB));
    }
    return sum.mul(graze).mul(lightGate);
};
