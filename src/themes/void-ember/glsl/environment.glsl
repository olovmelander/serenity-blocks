// ============================================================================
// Void Ember — environment (deep-space background)
//
// Phase 2: gives the void depth, scale and colour. Replaces the flat near-black
// background with:
//   - a rich space gradient (never pure black)
//   - a layered, domain-warped nebula with Beer extinction (near gas occludes
//     far gas) + colour regions, subtly lit by the star's black-body colour
//   - a faint diagonal Milky-Way band with dust lanes
//   - a believable multi-layer starfield: per-star black-body colour, twinkle,
//     and diffraction spikes on the brightest — no lone over-bright blue dot
//
// Pure helper module: takes everything as arguments (no global `params`), so it
// is concatenated between void-ember-common.glsl (for ve_* helpers) and
// scene.glsl (which calls ve_environment). The dedicated half-res + temporal
// pass from the plan is a deferred perf optimisation (Phase 7/8).
// ============================================================================

// Deep-space gradient — subtle, organic, never fully black.
vec3 ve_space_gradient(vec2 uv) {
    vec3 bottom = vec3(0.006, 0.006, 0.013);
    vec3 top = vec3(0.018, 0.012, 0.034);
    return mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
}

// Layered nebula: a near and a far gas sheet, the far one extincted (Beer) by
// the near one for a real sense of depth, tinted toward the star's colour.
vec3 ve_nebula(vec2 uv, float aspect, float time, float star_temp) {
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5) * 1.7;
    float t = time * 0.012;

    vec3 warp = ve_domain_warp(vec3(p, t), 0.55, 2);
    float near = max(0.0, ve_fbm(warp * 1.5, 3) - 0.40);
    float far = max(0.0, ve_fbm(warp * 2.7 + vec3(9.0, 3.0, 1.0), 2) - 0.42);

    float ct = clamp(far / max(near, 0.05) - 0.2, 0.0, 1.0);
    vec3 crimson = vec3(0.24, 0.06, 0.04);
    vec3 violet = vec3(0.08, 0.03, 0.14);
    vec3 teal = vec3(0.02, 0.07, 0.12);
    vec3 emis_near = mix(crimson, violet, ct);
    vec3 emis_far = mix(violet, teal, ct);

    // The star lights nearby gas — pull the emission gently toward its colour.
    vec3 star_tint = ve_blackbody(star_temp) * 0.22;
    vec3 near_c = mix(emis_near, star_tint, 0.16) * near;
    float trans = ve_beer(near * 2.0); // near gas occludes the far sheet
    vec3 far_c = mix(emis_far, star_tint, 0.1) * far * trans;

    return (near_c + far_c) * 2.6;
}

// Faint diagonal galactic band with clumps + dust lanes.
vec3 ve_milkyway(vec2 uv, float aspect, float time) {
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float ca = cos(-0.55);
    float sa = sin(-0.55);
    float across = p.x * sa + p.y * ca;
    float along = p.x * ca - p.y * sa;

    float band = exp(-across * across * 7.0);
    float clump = ve_fbm(vec3(along * 2.5, across * 5.0, time * 0.004), 3);
    float dust = clamp(1.0 - clump * 0.9, 0.2, 1.0); // darker where clumpier → lanes
    float glow = band * (0.35 + clump * 0.7) * dust;
    vec3 col = mix(vec3(0.05, 0.045, 0.08), vec3(0.08, 0.06, 0.055), clump);
    return col * glow * 0.5;
}

// One starfield layer. Each grid cell may host one star with its own black-body
// colour, size, magnitude and twinkle; the brightest get diffraction spikes.
vec3 ve_star_layer(vec2 p, float scale, float time, float density, float gain) {
    vec2 cell = floor(p * scale);
    vec2 rnd = ve_hash22(cell);
    if (rnd.x > density) { return vec3(0.0); }

    vec2 rnd2 = ve_hash22(cell + vec2(13.1, 47.7));
    vec2 center = vec2(0.15) + rnd2 * 0.7; // jitter, padded from cell edges
    vec2 local = fract(p * scale);
    vec2 delta = local - center;
    float d = length(delta);

    float size = mix(0.012, 0.05, rnd.y);
    float core = exp(-d * d / (size * size));
    float mag = pow(rnd2.x, 2.5); // power curve → most dim, few bright
    float twinkle = 0.7 + 0.3 * sin(time * (0.4 + rnd.y * 1.8) + rnd.x * 6.28318);

    // Mostly white → blue-white, with a warm minority. Kept BELOW the bloom
    // threshold so distant stars stay crisp points (no bloomed "orb" / mip-rings);
    // only the hero star + sparks are bright enough to bloom.
    float temp = 0.42 + rnd2.y * 0.55;
    vec3 col = ve_blackbody(temp) * 0.28;

    float intensity = core;
    if (mag > 0.6) {
        float sx = exp(-abs(delta.y) * 70.0) * exp(-abs(delta.x) * 7.0);
        float sy = exp(-abs(delta.x) * 70.0) * exp(-abs(delta.y) * 7.0);
        intensity = intensity + (sx + sy) * (mag - 0.6) * 0.6;
    }

    return col * intensity * mag * gain * twinkle;
}

vec3 ve_starfield(vec2 uv, float aspect, float time) {
    vec2 p = vec2(uv.x * aspect, uv.y);
    vec3 c = vec3(0.0);
    c = c + ve_star_layer(p, 70.0, time, 0.40, 0.40);
    c = c + ve_star_layer(p + vec2(11.3, 5.1), 38.0, time, 0.30, 0.62);
    c = c + ve_star_layer(p + vec2(31.7, 19.4), 16.0, time, 0.14, 0.9);
    return c;
}

// Composite the full deep-space environment.
vec3 ve_environment(vec2 uv, float aspect, float time, float star_temp) {
    vec3 c = ve_space_gradient(uv);
    c = c + ve_nebula(uv, aspect, time, star_temp);
    c = c + ve_milkyway(uv, aspect, time);
    c = c + ve_starfield(uv, aspect, time);
    return c;
}
