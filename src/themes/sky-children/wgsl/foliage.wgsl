// ============================================================
// Sky Children Phase 4 - Foliage Module
// Instanced blade helpers with layered wind + translucency cues.
// ============================================================

struct FoliageParams {
    color_base: vec3f,
    color_tip: vec3f,
    color_variation: f32,
    sss_color: vec3f,
    sss_intensity: f32,
    sss_distortion: f32,
    sss_power: f32,
    sky_normal_bias: f32,
    alpha: f32,
    wind_strength: f32,
    wind_frequency: f32,
    wind_direction: vec2f,
    gust_strength: f32,
    gust_frequency: f32,
    micro_strength: f32,
    micro_frequency: f32,
    blade_height: f32,
};

fn foliage_hash11(n: f32) -> f32 {
    return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
}

fn foliage_hash21(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn foliage_blade_local(vertex_index: u32) -> vec2f {
    let verts = array<vec2f, 6>(
        vec2f(-0.5, 0.0),
        vec2f(0.5, 0.0),
        vec2f(-0.18, 1.0),
        vec2f(-0.18, 1.0),
        vec2f(0.5, 0.0),
        vec2f(0.18, 1.0),
    );
    return verts[min(vertex_index, 5u)];
}

fn foliage_wind_layers(
    world_xz: vec2f,
    height_factor: f32,
    time: f32,
    params: FoliageParams,
    flexibility: f32,
) -> vec2f {
    let dir3 = safe_normalize(vec3f(params.wind_direction.x, 0.0, params.wind_direction.y));
    let dir = dir3.xz;
    let gust_dir = vec2f(-dir.y, dir.x);

    // Primary wave — smooth sinusoidal sweep across the field
    let phase_primary = dot(world_xz, dir) * 0.14;
    let primary = sin(time * params.wind_frequency + phase_primary) * params.wind_strength;

    // Secondary opposing wave for natural variety
    let phase_sec = dot(world_xz, dir) * 0.09 + 2.3;
    let secondary = sin(time * params.wind_frequency * 0.63 + phase_sec) * params.wind_strength * 0.38;

    // Gust — periodic cross-direction surge
    let phase_gust = dot(world_xz, gust_dir) * 0.1 + 1.7;
    let gust = sin(time * params.gust_frequency + phase_gust)
        * params.wind_strength
        * params.gust_strength;

    // Micro-turbulence per-blade
    let phase_micro = dot(world_xz, vec2f(0.73, 1.21)) * 0.31 + foliage_hash21(world_xz);
    let micro = sin(time * params.micro_frequency + phase_micro)
        * params.wind_strength
        * params.micro_strength;

    // Quadratic height weighting — tips sway far more than roots
    let bend = max(height_factor * height_factor * flexibility, 0.0);
    return (primary + secondary + micro) * dir * bend + gust * gust_dir * bend;
}

fn foliage_color_ramp(
    params: FoliageParams,
    height_factor: f32,
    variation: f32,
) -> vec3f {
    // Non-linear blend: base stays dark at root, tips transition sharply to bright
    let t = smoothstep(0.1, 0.85, height_factor);
    var color = mix(params.color_base, params.color_tip, t);
    // Per-blade variation: some darker, some yellower, some more vivid
    let var_offset = (variation - 0.5) * params.color_variation;
    color += vec3f(var_offset * 0.8, var_offset, var_offset * 0.5);
    // Golden sunlit sheen near tips
    let tip_glow = smoothstep(0.7, 1.0, height_factor) * 0.14;
    color += vec3f(0.12, 0.08, 0.0) * tip_glow;
    return max(color, vec3f(0.0));
}
