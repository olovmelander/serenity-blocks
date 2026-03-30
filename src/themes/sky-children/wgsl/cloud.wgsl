// ============================================================
// Sky Children Phase 3 - Cloud Module
// Procedural cloud layers with silhouette clarity and
// backlit silver-lining scattering.
// ============================================================

struct CloudParams {
    color_lit: vec3f,
    color_shadow: vec3f,
    color_ambient: vec3f,
    noise_scale: f32,
    noise_speed: f32,
    density_scale: f32,
    scatter_g: f32,
    scatter_intensity: f32,
    edge_softness: f32,
    opacity: f32,
    coverage: f32,
    softness: f32,
    silver_strength: f32,
    silhouette_strength: f32,
};

struct CloudSample {
    color: vec3f,
    alpha: f32,
    silhouette: f32,
    silver: f32,
};

fn cloud_hash12(p: vec2f) -> f32 {
    let p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    let q = p3 + vec3f(dot(p3, p3.yzx + vec3f(33.33)));
    return fract((q.x + q.y) * q.z);
}

fn cloud_noise2(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (vec2f(3.0) - 2.0 * f);
    let a = cloud_hash12(i);
    let b = cloud_hash12(i + vec2f(1.0, 0.0));
    let c = cloud_hash12(i + vec2f(0.0, 1.0));
    let d = cloud_hash12(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn cloud_beers_law(density: f32, thickness: f32) -> f32 {
    return exp(-max(density, 0.0) * max(thickness, 0.0));
}

fn cloud_powder_effect(density: f32) -> f32 {
    return 1.0 - exp(-max(density, 0.0) * 2.4);
}

fn cloud_henyey_greenstein(cos_theta: f32, g: f32) -> f32 {
    let anisotropy = clamp(g, -0.95, 0.95);
    let g2 = anisotropy * anisotropy;
    let denom = max(1.0 + g2 - 2.0 * anisotropy * cos_theta, 0.001);
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

fn cloud_density(
    uv: vec2f,
    time: f32,
    params: CloudParams,
    layer_offset: vec2f,
    layer_scale: f32,
    drift_scale: f32,
) -> f32 {
    let scale = max(params.noise_scale * layer_scale, 0.001);
    let drift = vec2f(time * params.noise_speed, -time * params.noise_speed * 0.33) * drift_scale;
    let sample_uv = uv * scale + layer_offset + drift;
    let macro_noise = cloud_noise2(sample_uv);
    let detail = cloud_noise2(sample_uv * 2.13 + layer_offset * 1.79);
    let wisps = cloud_noise2(sample_uv * 4.21 - layer_offset * 0.73);
    let billow = 1.0 - abs(macro_noise * 2.0 - 1.0);
    let raw_density = billow * 0.58 + macro_noise * 0.18 + detail * 0.18 + wisps * 0.06;

    let threshold = (params.coverage - 0.04) + sin((uv.x + uv.y + layer_offset.x) * 0.45) * 0.02;
    let softness = max(params.softness, 0.001);
    return smoothstep(threshold - softness * 1.4, threshold + softness * 0.85, raw_density);
}

fn cloud_layer(
    uv: vec2f,
    centered_uv: vec2f,
    view_dir: vec3f,
    sun_dir: vec3f,
    time: f32,
    params: CloudParams,
    layer_offset: vec2f,
    layer_scale: f32,
    drift_scale: f32,
) -> CloudSample {
    let density = cloud_density(uv, time, params, layer_offset, layer_scale, drift_scale);
    // Slightly wider gradient sampling to keep fluffy rounded silhouettes.
    let eps = 0.0024;
    let density_dx = cloud_density(
        uv + vec2f(eps, 0.0),
        time,
        params,
        layer_offset,
        layer_scale,
        drift_scale,
    );
    let density_dy = cloud_density(
        uv + vec2f(0.0, eps),
        time,
        params,
        layer_offset,
        layer_scale,
        drift_scale,
    );

    let grad_x = density_dx - density;
    let grad_y = density_dy - density;
    let n = safe_normalize(vec3f(
        -grad_x * 8.8 * params.silhouette_strength,
        -grad_y * 8.8 * params.silhouette_strength,
        1.0,
    ));

    let n_dot_l = saturate(dot(n, sun_dir));
    let density_term = density * params.density_scale;
    let absorption = cloud_beers_law(density_term, 0.56 + (1.0 - n_dot_l) * 1.45);
    let powder = cloud_powder_effect(density_term);
    let lit_amount = absorption * powder;

    var color = mix(params.color_shadow, params.color_lit, smoothstep(0.05, 0.88, lit_amount));
    // Enhanced silver lining — backlit glow
    let cos_theta = dot(view_dir, sun_dir);
    let phase = cloud_henyey_greenstein(cos_theta, params.scatter_g);
    let silver = phase
        * params.scatter_intensity
        * pow(saturate(1.0 - n_dot_l), 1.6)
        * params.silver_strength;
    color += params.color_lit * silver * 1.35;
    // Ambient fill in darker regions
    color += params.color_ambient * (0.12 + (1.0 - lit_amount) * 0.14);
    // Cotton-candy tops stay bright and creamy.
    let cotton = smoothstep(0.36, 0.92, density);
    color = mix(color, vec3f(1.0, 0.99, 0.97), cotton * 0.24);
    // Warm tint near base from sun scatter
    let warm_scatter = (1.0 - lit_amount) * saturate(sun_dir.y) * 0.08;
    color += vec3f(0.98, 0.92, 0.78) * warm_scatter;

    let grad_mag = abs(grad_x) + abs(grad_y);
    let silhouette = saturate(
        grad_mag * 10.0 * params.silhouette_strength
            + abs(centered_uv.y) * 0.04,
    );
    let edge_alpha = smoothstep(0.0, max(params.edge_softness, 0.001) * 1.35, density);
    let core_fill = smoothstep(0.32, 0.86, density) * 0.28;
    let alpha = (edge_alpha * 0.78 + core_fill) * params.opacity * (0.78 + silhouette * 0.22);

    return CloudSample(color, saturate(alpha), silhouette, silver);
}

fn cloud_render(
    uv: vec2f,
    centered_uv: vec2f,
    view_dir: vec3f,
    sun_dir: vec3f,
    time: f32,
    pulse: f32,
    combo: f32,
    params: CloudParams,
) -> CloudSample {
    // Horizon and vertical masks — clouds live in upper 55% of sky
    let horizon_mask = smoothstep(0.04, 0.96, uv.y);
    let belt_mask = smoothstep(0.22, 0.62, uv.y) * (1.0 - smoothstep(0.86, 0.99, uv.y));

    // Layer 1: Wide bank — large billowing cumulus, slowest drift
    let layer_bank = cloud_layer(
        uv * (0.78 + pulse * 0.028) + centered_uv * 0.012,
        centered_uv,
        view_dir,
        sun_dir,
        time,
        params,
        vec2f(0.37, 0.83),
        0.42 + combo * 0.04,
        0.28,
    );
    // Layer 2: Mid-distance clouds — medium scale, medium drift
    let layer_mid = cloud_layer(
        uv * 0.92 + centered_uv * 0.032,
        centered_uv,
        view_dir,
        sun_dir,
        time,
        params,
        vec2f(0.13, 0.59),
        0.66 + combo * 0.07,
        0.50,
    );
    // Layer 3: Near foreground clouds — smaller, faster, more textured
    let layer_near = cloud_layer(
        uv * (1.18 + pulse * 0.08) + centered_uv * 0.058,
        centered_uv,
        view_dir,
        sun_dir,
        time,
        params,
        vec2f(0.67, 0.21),
        1.02 + combo * 0.09,
        0.74,
    );
    // Layer 4: High cirrus wisps — very large scale, barely moving
    let layer_high = cloud_layer(
        uv * vec2f(0.62, 0.44) + vec2f(time * params.noise_speed * 0.18, 0.0),
        centered_uv,
        view_dir,
        sun_dir,
        time,
        params,
        vec2f(1.12, 0.44),
        0.31,
        0.14,
    );

    var accum_color = vec3f(0.0);
    var accum_alpha = 0.0;
    var accum_silhouette = 0.0;
    var accum_silver = 0.0;

    // High cirrus at top of sky (very transparent)
    let high_mask = smoothstep(0.62, 0.96, uv.y);
    let high_weight = layer_high.alpha * high_mask * (1.0 - accum_alpha) * 0.48;
    accum_color += layer_high.color * high_weight;
    accum_alpha += high_weight;
    accum_silver = max(accum_silver, layer_high.silver * high_mask * 0.6);

    // Wide bank clouds — dominant layer in mid-sky
    let bank_mask = smoothstep(0.24, 0.58, uv.y) * (1.0 - smoothstep(0.82, 0.97, uv.y));
    let bank_weight = layer_bank.alpha * bank_mask * (1.0 - accum_alpha) * 1.58;
    accum_color += layer_bank.color * bank_weight;
    accum_alpha += bank_weight;
    accum_silhouette = max(accum_silhouette, layer_bank.silhouette * bank_mask);
    accum_silver = max(accum_silver, layer_bank.silver * bank_mask);

    // Mid-distance fill
    let mid_weight = layer_mid.alpha * (1.0 - accum_alpha) * 1.08;
    accum_color += layer_mid.color * mid_weight;
    accum_alpha += mid_weight;
    accum_silhouette = max(accum_silhouette, layer_mid.silhouette);
    accum_silver = max(accum_silver, layer_mid.silver);

    // Near foreground accent clouds
    let near_weight = layer_near.alpha * (1.0 - accum_alpha) * 0.92;
    accum_color += layer_near.color * near_weight;
    accum_alpha += near_weight;
    accum_silhouette = max(accum_silhouette, layer_near.silhouette);
    accum_silver = max(accum_silver, layer_near.silver);

    if (accum_alpha <= 0.0001) {
        return CloudSample(vec3f(0.0), 0.0, 0.0, 0.0);
    }

    var cloud_color = accum_color / accum_alpha;
    // Brightening in thick regions for fluffy cotton-candy volume.
    cloud_color = mix(cloud_color, vec3f(1.0, 1.0, 1.0), saturate(accum_alpha * 0.34));
    // Near-horizon: blend with ambient sky color
    cloud_color = mix(cloud_color, params.color_ambient, (1.0 - horizon_mask) * 0.14);
    return CloudSample(
        cloud_color,
        saturate(accum_alpha * horizon_mask * mix(0.82, 1.08, belt_mask)),
        accum_silhouette * horizon_mask,
        accum_silver * horizon_mask,
    );
}
