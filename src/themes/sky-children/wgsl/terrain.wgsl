// ============================================================
// Sky Children Phase 2 - Terrain Module
// Tri-planar sand detail with distance-stable roughness falloff.
// ============================================================

struct TerrainParams {
    albedo_warm: vec3f,
    albedo_cool: vec3f,
    shadow_color: vec3f,
    triplanar_scale: f32,
    normal_strength: f32,
    ripple_scale: f32,
    ripple_sharpness: f32,
    roughness_near: f32,
    roughness_far: f32,
    roughness_falloff_start: f32,
    roughness_falloff_end: f32,
    shimmer_suppression: f32,
    height_scale: f32,
    horizon_lift: f32,
};

fn nlerp(a: vec3f, b: vec3f, t: f32) -> vec3f {
    return safe_normalize(mix(a, b, t));
}

fn terrain_hash12(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    let q = p3 + vec3f(dot(p3, p3.yzx + vec3f(33.33)));
    return fract((q.x + q.y) * q.z);
}

fn terrain_noise2(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (vec2f(3.0) - 2.0 * f);
    let a = terrain_hash12(i + vec2f(0.0, 0.0));
    let b = terrain_hash12(i + vec2f(1.0, 0.0));
    let c = terrain_hash12(i + vec2f(0.0, 1.0));
    let d = terrain_hash12(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn terrain_fbm(p: vec2f) -> f32 {
    var value = 0.0;
    var amp = 0.5;
    var pos = p;
    for (var i = 0; i < 4; i = i + 1) {
        value += amp * (terrain_noise2(pos) * 2.0 - 1.0);
        amp *= 0.5;
        pos = pos * 2.03 + vec2f(3.13, 1.27);
    }
    return value;
}

fn terrain_height(ground_uv: vec2f, time: f32, terrain: TerrainParams) -> f32 {
    let drift = ground_uv + vec2f(time * 0.06, -time * 0.018);
    // Broad rolling hills — large sine waves for Sky's gentle landscape feel
    let macro_wave = sin(drift.x * 0.11) * 1.8 + cos(drift.y * 0.09) * 1.5
        + sin(drift.x * 0.07 + drift.y * 0.05) * 1.2;
    // Mid-frequency ridge bumps for distinct hilltops
    let ridge = terrain_fbm(drift * 0.26) * 1.85;
    // Fine surface detail
    let dune_detail = terrain_fbm(drift * (terrain.ripple_scale * 0.078)) * 0.28;
    // Large elevated mounds on the sides (like Sky's dome-shaped islands)
    let mound_a = exp(-pow((drift.x + 9.2) * 0.14, 2.0) - pow((drift.y - 8.4) * 0.08, 2.0)) * 3.2;
    let mound_b = exp(-pow((drift.x - 9.8) * 0.15, 2.0) - pow((drift.y - 9.0) * 0.09, 2.0)) * 3.0;
    let mound_c = exp(-pow((drift.x + 2.4) * 0.19, 2.0) - pow((drift.y - 14.0) * 0.1, 2.0)) * 2.2;
    // Central valley for the path to run through
    let valley = exp(-pow(drift.x * 0.13, 2.0)) * (1.8 + 0.4 * sin(drift.y * 0.1 + time * 0.035));
    let dune_sharpness = max(0.5, terrain.ripple_sharpness * 0.22);
    let dune_shape = sign(dune_detail) * pow(abs(dune_detail), dune_sharpness);
    return (macro_wave + ridge + dune_shape + mound_a + mound_b + mound_c - valley) * terrain.height_scale;
}

fn terrain_height_gradient(
    ground_uv: vec2f,
    time: f32,
    terrain: TerrainParams,
    base_height: f32,
) -> vec2f {
    let eps = 0.08;
    let hx = terrain_height(ground_uv + vec2f(eps, 0.0), time, terrain);
    let hy = terrain_height(ground_uv + vec2f(0.0, eps), time, terrain);
    return vec2f((hx - base_height) / eps, (hy - base_height) / eps);
}

fn terrain_triplanar_weights(world_normal: vec3f) -> vec3f {
    let an = abs(world_normal);
    let weighted = pow(an, vec3f(4.0));
    return weighted / max(weighted.x + weighted.y + weighted.z, 0.0001);
}

fn terrain_sample_pseudo_normal(uv: vec2f, seed: f32) -> vec3f {
    let p = uv * 1.65;
    let base = terrain_noise2(p + vec2f(seed, seed * 1.7));
    let nx = terrain_noise2(p + vec2f(0.17 + seed, seed * 1.31)) - base;
    let nz = terrain_noise2(p + vec2f(seed * 0.73, 0.23 + seed)) - base;
    return safe_normalize(vec3f(nx * 2.2, 1.0, nz * 2.2));
}

fn terrain_triplanar_normal(
    world_pos: vec3f,
    world_normal: vec3f,
    terrain: TerrainParams,
    detail_attn: f32,
) -> vec3f {
    let weights = terrain_triplanar_weights(world_normal);
    let p = world_pos * max(terrain.triplanar_scale, 0.0001);

    let n_x = terrain_sample_pseudo_normal(p.yz, 0.11);
    let n_y = terrain_sample_pseudo_normal(p.xz, 0.37);
    let n_z = terrain_sample_pseudo_normal(p.xy, 0.73);

    let blended = safe_normalize(n_x * weights.x + n_y * weights.y + n_z * weights.z);
    return nlerp(world_normal, blended, saturate(detail_attn));
}

fn terrain_distance_roughness(distance: f32, terrain: TerrainParams) -> f32 {
    let t = saturate(
        (distance - terrain.roughness_falloff_start)
        / max(terrain.roughness_falloff_end - terrain.roughness_falloff_start, 0.001),
    );
    return mix(terrain.roughness_near, terrain.roughness_far, t);
}

fn terrain_detail_attenuation(distance: f32, terrain: TerrainParams) -> f32 {
    let rough = terrain_distance_roughness(distance, terrain);
    let near_to_far = max(terrain.roughness_far - terrain.roughness_near, 0.001);
    let rough_t = saturate((rough - terrain.roughness_near) / near_to_far);
    return 1.0 - rough_t * saturate(terrain.shimmer_suppression);
}

fn terrain_albedo(height: f32, steepness: f32, pulse: f32, combo: f32, terrain: TerrainParams) -> vec3f {
    // Height-based warm/cool blend — hilltops catch more sunlight
    let height_norm = saturate(0.5 + height * 0.08);
    let warm_mix = saturate(0.44 + height_norm * 0.18 + combo * 0.1);
    var albedo = mix(terrain.albedo_cool, terrain.albedo_warm, warm_mix);
    // Bright sun-facing hilltop lift — vivid grass like Sky
    let sunlit_hilltop = vec3f(0.62, 0.94, 0.38);
    albedo = mix(albedo, sunlit_hilltop, smoothstep(0.55, 0.82, height_norm) * (0.38 + pulse * 0.12));
    // Steep slope darkening (ravines, valley floors)
    albedo = mix(albedo, terrain.albedo_cool * vec3f(0.72, 0.82, 0.78), steepness * 0.22);
    // Subtle flower scatter hint in the base albedo
    let flower_hue = vec3f(0.94, 0.82, 0.90);
    albedo += flower_hue * (1.0 - steepness) * combo * 0.022;
    return albedo;
}
