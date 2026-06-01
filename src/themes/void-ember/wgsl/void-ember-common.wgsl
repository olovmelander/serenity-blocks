// ============================================================================
// Void Ember AAA — shared WGSL helper library
//
// Single source of truth for the maths every render/compute module needs:
// hashing, value noise, rotated FBM, black-body colour, Henyey–Greenstein
// phase, and Beer–Lambert transmittance. Phase 1+ modules concatenate this
// snippet (via `?raw` import) ahead of their own code so there is no copy-paste
// drift between flow.wgsl / particles.wgsl / star.wgsl / environment.wgsl.
//
// SCAFFOLD: not yet imported anywhere (Phase 0 leaves the render path untouched).
// See docs/VOID_EMBER_AAA_PLAN.md §4.
// ============================================================================

const VE_PI: f32 = 3.14159265359;
const VE_TAU: f32 = 6.28318530718;

// --- Hashing -----------------------------------------------------------------

fn ve_hash12(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn ve_hash13(p: vec3f) -> f32 {
    return fract(sin(dot(p, vec3f(127.1, 311.7, 191.999))) * 43758.5453123);
}

fn ve_hash22(p: vec2f) -> vec2f {
    return vec2f(
        fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123),
        fract(sin(dot(p, vec2f(269.5, 183.3))) * 43758.5453123),
    );
}

// --- Value noise -------------------------------------------------------------

fn ve_noise3(p: vec3f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let n000 = ve_hash13(i + vec3f(0.0, 0.0, 0.0));
    let n100 = ve_hash13(i + vec3f(1.0, 0.0, 0.0));
    let n010 = ve_hash13(i + vec3f(0.0, 1.0, 0.0));
    let n110 = ve_hash13(i + vec3f(1.0, 1.0, 0.0));
    let n001 = ve_hash13(i + vec3f(0.0, 0.0, 1.0));
    let n101 = ve_hash13(i + vec3f(1.0, 0.0, 1.0));
    let n011 = ve_hash13(i + vec3f(0.0, 1.0, 1.0));
    let n111 = ve_hash13(i + vec3f(1.0, 1.0, 1.0));

    let nx00 = mix(n000, n100, u.x);
    let nx10 = mix(n010, n110, u.x);
    let nx01 = mix(n001, n101, u.x);
    let nx11 = mix(n011, n111, u.x);
    let nxy0 = mix(nx00, nx10, u.y);
    let nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

// --- Rotation (per-octave rotation kills axis-aligned FBM artifacts) ----------

fn ve_rot_y(a: f32) -> mat3x3f {
    let c = cos(a);
    let s = sin(a);
    return mat3x3f(
        vec3f(c, 0.0, -s),
        vec3f(0.0, 1.0, 0.0),
        vec3f(s, 0.0, c),
    );
}

fn ve_rot_z(a: f32) -> mat3x3f {
    let c = cos(a);
    let s = sin(a);
    return mat3x3f(
        vec3f(c, -s, 0.0),
        vec3f(s, c, 0.0),
        vec3f(0.0, 0.0, 1.0),
    );
}

// Rotated fractional Brownian motion. `octaves` should be a compile-time-ish
// small constant at the call site; lacunarity ~2.02, gain ~0.5.
fn ve_fbm(p_in: vec3f, octaves: i32) -> f32 {
    var p = p_in;
    var value = 0.0;
    var amplitude = 0.5;
    let rot = ve_rot_z(0.913) * ve_rot_y(1.217);
    for (var o = 0; o < octaves; o = o + 1) {
        value = value + ve_noise3(p) * amplitude;
        p = (rot * p) * 2.02;
        amplitude = amplitude * 0.5;
    }
    return value;
}

// Two-call domain warp: returns a position pushed by low-frequency FBM. Use the
// result as the sample coordinate for the final density read to get swirling
// plasma filaments / sunspot tendrils.
fn ve_domain_warp(p: vec3f, strength: f32, octaves: i32) -> vec3f {
    let q = vec3f(
        ve_fbm(p + vec3f(0.0, 0.0, 0.0), octaves),
        ve_fbm(p + vec3f(5.2, 1.3, 0.0), octaves),
        ve_fbm(p + vec3f(1.7, 9.2, 3.4), octaves),
    );
    return p + (q - 0.5) * strength;
}

// --- Black-body colour -------------------------------------------------------

// Approximate incandescent colour from a normalized "heat" t (0 = deep-red
// ember ~1200K, 1 = blue-white ~9000K+). Returns linear RGB; the hot end pushes
// > 1 so it blooms. Hand-fit to the Planckian locus for a believable ember→star
// ramp without a full spectral integral.
fn ve_blackbody(t_in: f32) -> vec3f {
    let t = clamp(t_in, 0.0, 1.0);
    // Five perceptual stops along the locus (linear-space, HDR at the top).
    let c0 = vec3f(0.35, 0.02, 0.005);   // dim deep red
    let c1 = vec3f(1.10, 0.18, 0.03);    // volcanic orange
    let c2 = vec3f(1.90, 0.75, 0.18);    // amber
    let c3 = vec3f(2.60, 1.90, 1.10);    // near-white hot
    let c4 = vec3f(2.20, 2.40, 3.20);    // blue-white
    let f = t * 4.0;
    var col: vec3f;
    if (f < 1.0) {
        col = mix(c0, c1, smoothstep(0.0, 1.0, f));
    } else if (f < 2.0) {
        col = mix(c1, c2, smoothstep(0.0, 1.0, f - 1.0));
    } else if (f < 3.0) {
        col = mix(c2, c3, smoothstep(0.0, 1.0, f - 2.0));
    } else {
        col = mix(c3, c4, smoothstep(0.0, 1.0, f - 3.0));
    }
    return col;
}

// --- Scattering / absorption -------------------------------------------------

// Henyey–Greenstein phase function. g in (-1,1): g>0 forward scatter, g<0 back.
fn ve_henyey_greenstein(cos_theta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 1.0 + g2 - 2.0 * g * cos_theta;
    return (1.0 - g2) / (4.0 * VE_PI * pow(max(denom, 1e-4), 1.5));
}

// Beer–Lambert transmittance for an optical depth (density * distance).
fn ve_beer(optical_depth: f32) -> f32 {
    return exp(-optical_depth);
}

// Powder/Beer combo — fakes dark-edge → bright-core look on dense media.
fn ve_beer_powder(optical_depth: f32) -> f32 {
    let beer = exp(-optical_depth);
    let powder = 1.0 - exp(-optical_depth * 2.0);
    return beer * powder * 2.0;
}
