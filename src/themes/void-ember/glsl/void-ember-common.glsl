// ============================================================================
// Void Ember AAA — shared WGSL helper library
//
// GLSL counterpart of wgsl/void-ember-common.glsl for the maths every render/compute module needs:
// hashing, value noise, rotated FBM, black-body colour, Henyey–Greenstein
// phase, and Beer–Lambert transmittance. Phase 1+ modules concatenate this
// snippet (via `?raw` import) ahead of their own code so there is no copy-paste
// drift between flow.wgsl / particles.wgsl / star.wgsl / environment.glsl.
//
// GLSL compatibility equations mirror the native WGSL library.
// ============================================================================

const float VE_PI = 3.14159265359;
const float VE_TAU = 6.28318530718;

// --- Hashing -----------------------------------------------------------------

float ve_hash12(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float ve_hash13(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 191.999))) * 43758.5453123);
}

vec2 ve_hash22(vec2 p) {
    return vec2(
        fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123),
        fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453123));
}

// --- Value noise -------------------------------------------------------------

float ve_noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    float n000 = ve_hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = ve_hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = ve_hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = ve_hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = ve_hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = ve_hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = ve_hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = ve_hash13(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    float nxy0 = mix(nx00, nx10, u.y);
    float nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

// --- Rotation (per-octave rotation kills axis-aligned FBM artifacts) ----------

mat3 ve_rot_y(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(
        vec3(c, 0.0, -s),
        vec3(0.0, 1.0, 0.0),
        vec3(s, 0.0, c));
}

mat3 ve_rot_z(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(
        vec3(c, -s, 0.0),
        vec3(s, c, 0.0),
        vec3(0.0, 0.0, 1.0));
}

// Rotated fractional Brownian motion. `octaves` should be a compile-time-ish
// small constant at the call site; lacunarity ~2.02, gain ~0.5.
float ve_fbm(vec3 p_in, int octaves) {
    vec3 p = p_in;
    float value = 0.0;
    float amplitude = 0.5;
    mat3 rot = ve_rot_z(0.913) * ve_rot_y(1.217);
    for (int o = 0; o < octaves; o = o + 1) {
        value = value + ve_noise3(p) * amplitude;
        p = (rot * p) * 2.02;
        amplitude = amplitude * 0.5;
    }
    return value;
}

// Two-call domain warp: returns a position pushed by low-frequency FBM. Use the
// result as the sample coordinate for the final density read to get swirling
// plasma filaments / sunspot tendrils.
vec3 ve_domain_warp(vec3 p, float strength, int octaves) {
    vec3 q = vec3(
        ve_fbm(p + vec3(0.0, 0.0, 0.0), octaves),
        ve_fbm(p + vec3(5.2, 1.3, 0.0), octaves),
        ve_fbm(p + vec3(1.7, 9.2, 3.4), octaves));
    return p + (q - 0.5) * strength;
}

// --- Black-body colour -------------------------------------------------------

// Approximate incandescent colour from a normalized "heat" t (0 = deep-red
// ember ~1200K, 1 = blue-white ~9000K+). Returns linear RGB; the hot end pushes
// > 1 so it blooms. Hand-fit to the Planckian locus for a believable ember→star
// ramp without a full spectral integral.
vec3 ve_blackbody(float t_in) {
    float t = clamp(t_in, 0.0, 1.0);
    // Five perceptual stops along the locus (linear-space, HDR at the top).
    vec3 c0 = vec3(0.35, 0.02, 0.005);   // dim deep red
    vec3 c1 = vec3(1.10, 0.18, 0.03);    // volcanic orange
    vec3 c2 = vec3(1.90, 0.75, 0.18);    // amber
    vec3 c3 = vec3(2.60, 1.90, 1.10);    // near-white hot
    vec3 c4 = vec3(2.20, 2.40, 3.20);    // blue-white
    float f = t * 4.0;
    vec3 col;
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
float ve_henyey_greenstein(float cos_theta, float g) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cos_theta;
    return (1.0 - g2) / (4.0 * VE_PI * pow(max(denom, 1e-4), 1.5));
}

// Beer–Lambert transmittance for an optical depth (density * distance).
float ve_beer(float optical_depth) {
    return exp(-optical_depth);
}

// Powder/Beer combo — fakes dark-edge → bright-core look on dense media.
float ve_beer_powder(float optical_depth) {
    float beer = exp(-optical_depth);
    float powder = 1.0 - exp(-optical_depth * 2.0);
    return beer * powder * 2.0;
}
