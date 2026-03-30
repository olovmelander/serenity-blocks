// ============================================================
// Sky Children Phase 1 - Stylized Lighting Core
// Journey-derived lighting functions for painterly warm/cool look.
// ============================================================

struct LightParams {
    direction: vec3f,      // Surface -> light direction
    color: vec3f,          // HDR light color
    intensity: f32,
    ambient_color: vec3f,  // Sky/ambient shadow fill color
    ambient_intensity: f32,
};

struct SurfaceParams {
    normal: vec3f,   // World-space normal
    view_dir: vec3f, // Surface -> camera
    albedo: vec3f,
    roughness: f32,
};

struct JourneySpecularParams {
    rim_power: f32,
    rim_strength: f32,
    rim_color: vec3f,
    ocean_power: f32,
    ocean_strength: f32,
    ocean_color: vec3f,
};

struct JourneyShadowParams {
    shadow_tint: vec3f,
    shadow_boost: f32,
};

struct JourneyGlitterParams {
    grain_normal: vec3f, // Pass vec3f(0.0) to disable glitter
    threshold: f32,
    intensity: f32,
    color: vec3f,
};

fn saturate(v: f32) -> f32 {
    return clamp(v, 0.0, 1.0);
}

fn safe_normalize(v: vec3f) -> vec3f {
    let len_sq = dot(v, v);
    if (len_sq > 1e-10) {
        return v * inverseSqrt(len_sq);
    }
    return vec3f(0.0, 1.0, 0.0);
}

fn project_to_tangent(direction: vec3f, normal: vec3f, n_dot: f32) -> vec3f {
    let tangent = direction - normal * n_dot;
    let len_sq = dot(tangent, tangent);
    if (len_sq > 1e-10) {
        return tangent * inverseSqrt(len_sq);
    }
    return vec3f(0.0);
}

// Journey defaults:
// - y normal compression = 0.3
// - diffuse multiplier = 4.0
fn journey_diffuse(normal: vec3f, light_dir: vec3f) -> f32 {
    var n = normal;
    n.y *= 0.3;
    n = safe_normalize(n);
    let n_dot_l = dot(n, safe_normalize(light_dir));
    return saturate(4.0 * n_dot_l);
}

// Runtime-tunable variant used by later modules.
fn journey_diffuse_custom(
    normal: vec3f,
    light_dir: vec3f,
    y_compression: f32,
    diffuse_multiplier: f32,
) -> f32 {
    var n = normal;
    n.y *= y_compression;
    n = safe_normalize(n);
    let n_dot_l = dot(n, safe_normalize(light_dir));
    return saturate(diffuse_multiplier * n_dot_l);
}

fn oren_nayar_diffuse(
    normal: vec3f,
    light_dir: vec3f,
    view_dir: vec3f,
    roughness: f32,
) -> f32 {
    let n = safe_normalize(normal);
    let l = safe_normalize(light_dir);
    let v = safe_normalize(view_dir);

    let n_dot_l = max(dot(n, l), 0.0);
    let n_dot_v = max(dot(n, v), 0.0);
    if (n_dot_l <= 0.0 || n_dot_v <= 0.0) {
        return 0.0;
    }

    let sigma2 = roughness * roughness;
    let A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
    let B = 0.45 * sigma2 / (sigma2 + 0.09);

    let theta_i = acos(clamp(n_dot_l, 0.0, 1.0));
    let theta_r = acos(clamp(n_dot_v, 0.0, 1.0));
    let alpha = max(theta_i, theta_r);
    let beta = min(theta_i, theta_r);

    let light_proj = project_to_tangent(l, n, n_dot_l);
    let view_proj = project_to_tangent(v, n, n_dot_v);
    let cos_phi_diff = max(dot(light_proj, view_proj), 0.0);

    let tan_beta = tan(min(beta, 1.553343)); // ~89 degrees
    return n_dot_l * (A + B * cos_phi_diff * sin(alpha) * tan_beta);
}

fn fresnel_rim(n_dot_v: f32, power: f32, strength: f32) -> f32 {
    return pow(saturate(1.0 - n_dot_v), power) * strength;
}

fn ocean_specular(
    normal: vec3f,
    light_dir: vec3f,
    view_dir: vec3f,
    power: f32,
    strength: f32,
) -> f32 {
    let n = safe_normalize(normal);
    let l = safe_normalize(light_dir);
    let v = safe_normalize(view_dir);
    let half_vec = safe_normalize(v + l);
    let n_dot_h = max(dot(n, half_vec), 0.0);
    return pow(n_dot_h, power) * strength;
}

fn glitter_specular(
    grain_normal: vec3f,
    light_dir: vec3f,
    view_dir: vec3f,
    threshold: f32,
    intensity: f32,
) -> f32 {
    let gn = safe_normalize(grain_normal);
    let l = safe_normalize(light_dir);
    let v = safe_normalize(view_dir);
    let reflected = reflect(-l, gn);
    let r_dot_v = saturate(dot(reflected, v));
    let sparkle = saturate((r_dot_v - threshold) / max(1.0 - threshold, 0.0001));
    return sparkle * sparkle * intensity;
}

fn colored_shadow_blend(
    diffuse_factor: f32,
    lit_color: vec3f,
    shadow_color: vec3f,
    shadow_boost: f32,
) -> vec3f {
    let blended = mix(shadow_color, lit_color, diffuse_factor);
    let luma = dot(blended, vec3f(0.2126, 0.7152, 0.0722));
    return mix(vec3f(luma), blended, 1.0 + shadow_boost * (1.0 - diffuse_factor));
}

// Journey assembly order:
// diffuse = shadow/lit blend
// specular = max(rim, ocean) + glitter
fn calculate_journey_lighting_custom(
    surface: SurfaceParams,
    light: LightParams,
    specular: JourneySpecularParams,
    shadow: JourneyShadowParams,
    glitter: JourneyGlitterParams,
    y_normal_compression: f32,
    diffuse_multiplier: f32,
) -> vec3f {
    let n = safe_normalize(surface.normal);
    let l = safe_normalize(light.direction);
    let v = safe_normalize(surface.view_dir);

    let diffuse = journey_diffuse_custom(
        n,
        l,
        saturate(y_normal_compression),
        max(diffuse_multiplier, 0.01),
    );
    let lit_color = surface.albedo * light.color * light.intensity;
    let shadow_color = surface.albedo * shadow.shadow_tint * light.ambient_color * light.ambient_intensity;
    let base = colored_shadow_blend(diffuse, lit_color, shadow_color, shadow.shadow_boost);

    let n_dot_v = dot(n, v);
    let rim = fresnel_rim(n_dot_v, specular.rim_power, specular.rim_strength);
    let rim_contrib = specular.rim_color * rim;

    let ocean = ocean_specular(n, l, v, specular.ocean_power, specular.ocean_strength);
    let ocean_contrib = specular.ocean_color * ocean;

    // max(rim, ocean) to prevent over-bright additive stacking
    let spec_base = max(rim_contrib, ocean_contrib);

    var glitter_contrib = vec3f(0.0);
    if (length(glitter.grain_normal) > 0.01) {
        let g = glitter_specular(
            glitter.grain_normal,
            l,
            v,
            glitter.threshold,
            glitter.intensity,
        );
        glitter_contrib = glitter.color * g;
    }

    return base + spec_base + glitter_contrib;
}

fn calculate_journey_lighting(
    surface: SurfaceParams,
    light: LightParams,
    specular: JourneySpecularParams,
    shadow: JourneyShadowParams,
    glitter: JourneyGlitterParams,
) -> vec3f {
    return calculate_journey_lighting_custom(
        surface,
        light,
        specular,
        shadow,
        glitter,
        0.3,
        4.0,
    );
}
