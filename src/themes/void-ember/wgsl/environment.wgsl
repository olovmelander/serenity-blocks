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
// is concatenated between void-ember-common.wgsl (for ve_* helpers) and
// scene.wgsl (which calls ve_environment). The dedicated half-res + temporal
// pass from the plan is a deferred perf optimisation (Phase 7/8).
// ============================================================================

// Deep-space gradient — subtle, organic, never fully black.
fn ve_space_gradient(uv: vec2f) -> vec3f {
    let bottom = vec3f(0.006, 0.006, 0.013);
    let top = vec3f(0.018, 0.012, 0.034);
    return mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
}

// Layered nebula: a near and a far gas sheet, the far one extincted (Beer) by
// the near one for a real sense of depth, tinted toward the star's colour.
fn ve_nebula(uv: vec2f, aspect: f32, time: f32, star_temp: f32) -> vec3f {
    let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 1.7;
    let t = time * 0.012;

    let warp = ve_domain_warp(vec3f(p, t), 0.55, 2);
    let near = max(0.0, ve_fbm(warp * 1.5, 3) - 0.40);
    let far = max(0.0, ve_fbm(warp * 2.7 + vec3f(9.0, 3.0, 1.0), 2) - 0.42);

    let ct = clamp(far / max(near, 0.05) - 0.2, 0.0, 1.0);
    let crimson = vec3f(0.24, 0.06, 0.04);
    let violet = vec3f(0.08, 0.03, 0.14);
    let teal = vec3f(0.02, 0.07, 0.12);
    let emis_near = mix(crimson, violet, ct);
    let emis_far = mix(violet, teal, ct);

    // The star lights nearby gas — pull the emission gently toward its colour.
    let star_tint = ve_blackbody(star_temp) * 0.22;
    let near_c = mix(emis_near, star_tint, 0.16) * near;
    let trans = ve_beer(near * 2.0); // near gas occludes the far sheet
    let far_c = mix(emis_far, star_tint, 0.1) * far * trans;

    return (near_c + far_c) * 2.6;
}

// Faint diagonal galactic band with clumps + dust lanes.
fn ve_milkyway(uv: vec2f, aspect: f32, time: f32) -> vec3f {
    let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
    let ca = cos(-0.55);
    let sa = sin(-0.55);
    let across = p.x * sa + p.y * ca;
    let along = p.x * ca - p.y * sa;

    let band = exp(-across * across * 7.0);
    let clump = ve_fbm(vec3f(along * 2.5, across * 5.0, time * 0.004), 3);
    let dust = clamp(1.0 - clump * 0.9, 0.2, 1.0); // darker where clumpier → lanes
    let glow = band * (0.35 + clump * 0.7) * dust;
    let col = mix(vec3f(0.05, 0.045, 0.08), vec3f(0.08, 0.06, 0.055), clump);
    return col * glow * 0.5;
}

// One starfield layer. Each grid cell may host one star with its own black-body
// colour, size, magnitude and twinkle; the brightest get diffraction spikes.
fn ve_star_layer(p: vec2f, scale: f32, time: f32, density: f32, gain: f32) -> vec3f {
    let cell = floor(p * scale);
    let rnd = ve_hash22(cell);
    if (rnd.x > density) { return vec3f(0.0); }

    let rnd2 = ve_hash22(cell + vec2f(13.1, 47.7));
    let center = vec2f(0.15) + rnd2 * 0.7; // jitter, padded from cell edges
    let local = fract(p * scale);
    let delta = local - center;
    let d = length(delta);

    let size = mix(0.012, 0.05, rnd.y);
    let core = exp(-d * d / (size * size));
    let mag = pow(rnd2.x, 2.5); // power curve → most dim, few bright
    let twinkle = 0.7 + 0.3 * sin(time * (0.4 + rnd.y * 1.8) + rnd.x * 6.28318);

    // Mostly white → blue-white, with a warm minority. Kept BELOW the bloom
    // threshold so distant stars stay crisp points (no bloomed "orb" / mip-rings);
    // only the hero star + sparks are bright enough to bloom.
    let temp = 0.42 + rnd2.y * 0.55;
    let col = ve_blackbody(temp) * 0.28;

    var intensity = core;
    if (mag > 0.6) {
        let sx = exp(-abs(delta.y) * 70.0) * exp(-abs(delta.x) * 7.0);
        let sy = exp(-abs(delta.x) * 70.0) * exp(-abs(delta.y) * 7.0);
        intensity = intensity + (sx + sy) * (mag - 0.6) * 0.6;
    }

    return col * intensity * mag * gain * twinkle;
}

fn ve_starfield(uv: vec2f, aspect: f32, time: f32) -> vec3f {
    let p = vec2f(uv.x * aspect, uv.y);
    var c = vec3f(0.0);
    c = c + ve_star_layer(p, 70.0, time, 0.40, 0.40);
    c = c + ve_star_layer(p + vec2f(11.3, 5.1), 38.0, time, 0.30, 0.62);
    c = c + ve_star_layer(p + vec2f(31.7, 19.4), 16.0, time, 0.14, 0.9);
    return c;
}

// Composite the full deep-space environment.
fn ve_environment(uv: vec2f, aspect: f32, time: f32, star_temp: f32) -> vec3f {
    var c = ve_space_gradient(uv);
    c = c + ve_nebula(uv, aspect, time, star_temp);
    c = c + ve_milkyway(uv, aspect, time);
    c = c + ve_starfield(uv, aspect, time);
    return c;
}
