// Same lensing, heat haze, ACES, exposure, vignette and grain as wgsl/post.wgsl.
// Mobile uses a bounded bright-pass blur instead of the native temporal pyramid.
float ve_luminance(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
vec3 ve_aces(vec3 color) {
    return clamp((color * (2.51 * color + 0.03)) /
        (color * (2.43 * color + 0.59) + 0.14), vec3(0.0), vec3(1.0));
}
vec3 ve_bright(vec2 uv) {
    vec3 color = texture(scene_texture, uv).rgb;
    float luma = ve_luminance(color);
    float threshold = max(params.post.y - params.fx.y * 0.22, 0.25);
    float gain = max(luma - threshold, 0.0) * smoothstep(threshold, threshold + 1.25, luma);
    return color * gain / max(luma, 0.001);
}
vec4 ve_post(vec2 uv) {
    vec2 texel = params.resolution.zw;
    float flare = params.fx.y;
    float flash = params.fx.z;
    float intensity = params.fx.w;
    float time = params.sim.x;
    vec2 to_ember = uv - params.ember.xy;
    float lens_dist = length(to_ember * vec2(params.sim.z, 1.0));
    float lens_ring = exp(-lens_dist * 12.0) * (1.0 - exp(-lens_dist * 60.0));
    vec2 lensed = uv + normalize(to_ember + vec2(0.00001)) * lens_ring *
        (0.012 + intensity * 0.004 + flare * 0.008);
    vec2 heat_noise = vec2(ve_noise3(vec3(uv * 22.0, time * 0.7)),
        ve_noise3(vec3(uv * 22.0 + vec2(7.3, 2.1), time * 0.7 + 4.0)));
    lensed += (heat_noise - 0.5) * exp(-lens_dist * 3.2) *
        (0.0025 + params.star0.z * 0.004 + flare * 0.003);
    vec2 ca = normalize(uv - 0.5 + vec2(0.00001)) * dot(uv - 0.5, uv - 0.5) *
        (0.004 + flare * 0.004);
    vec3 base = vec3(texture(scene_texture, lensed + ca).r,
        texture(scene_texture, lensed).g, texture(scene_texture, lensed - ca).b);
    vec3 neighbors = (texture(scene_texture, lensed + vec2(texel.x, 0.0)).rgb +
        texture(scene_texture, lensed - vec2(texel.x, 0.0)).rgb +
        texture(scene_texture, lensed + vec2(0.0, texel.y)).rgb +
        texture(scene_texture, lensed - vec2(0.0, texel.y)).rgb) * 0.25;
    float hot_guard = 1.0 - smoothstep(1.3, 5.0, ve_luminance(base));
    base = max(base + (base - neighbors) * clamp(params.misc.w, 0.0, 0.35) *
        mix(0.35, 1.0, hot_guard), vec3(0.0));
    vec3 bloom = texture(bloom_texture, lensed).rgb * 0.2;
    for (int a = 0; a < 8; a++) {
        float angle = float(a) * 0.785398;
        vec2 direction = vec2(cos(angle), sin(angle));
        bloom += texture(bloom_texture, lensed + direction * texel * 8.0).rgb * 0.06;
        bloom += texture(bloom_texture, lensed + direction * texel * 20.0).rgb * 0.04;
    }
    float streak = params.post.z + flare * 0.04;
    bloom += (ve_bright(lensed + vec2(-8.0, 0.0) * texel) +
        ve_bright(lensed + vec2(8.0, 0.0) * texel)) * streak * 0.45;
    vec3 rays = vec3(0.0);
    vec2 ray_uv = lensed;
    vec2 ray_dir = (params.ember.xy - lensed) * 0.14;
    float decay = 1.0;
    for (int r = 0; r < 6; r++) {
        ray_uv += ray_dir;
        vec3 sample_color = texture(scene_texture, clamp(ray_uv, 0.001, 0.999)).rgb;
        rays += sample_color * max(ve_luminance(sample_color) - 0.55, 0.0) * decay *
            (0.045 + flare * 0.025 + flash * 0.04);
        decay *= 0.88;
    }
    vec3 color = base + bloom * params.post.x * 0.6 *
        (1.0 + flare * 0.45 + flash * 0.6 + intensity * 0.1) + rays;
    if (params.post.z > 0.0001) {
        vec3 ghosts = ve_lens_ghosts(bloom_texture, uv, 0.32, 0.012 + flare * 0.01);
        vec3 halo = ve_lens_halo(bloom_texture, uv, 0.42);
        color += (ghosts + halo) * vec3(1.0, 0.72, 0.45) *
            (params.post.z * 5.0 + flare * 0.4);
        color += ve_blackbody(min(1.0, params.star0.x + 0.15)) *
            ve_starburst(uv, params.ember.xy, params.sim.z, time) *
            (0.5 + params.star0.z * 1.2 + flare * 1.5) * (0.4 + params.post.z * 6.0);
    }
    vec2 vignette_coord = uv * (1.0 - uv.yx);
    float vignette = pow(clamp(vignette_coord.x * vignette_coord.y * 20.0, 0.0, 1.0),
        0.34 + intensity * 0.06);
    color *= mix(1.0 - params.misc.x, 1.0, vignette);
    color = ve_aces(color * (params.colorA.w + flash * 0.15 + flare * 0.06));
    float grain = ve_hash12(uv * params.resolution.xy + vec2(time * 91.7, params.sim.w)) - 0.5;
    color = clamp(color + grain * (params.misc.y + 0.012) *
        (1.0 - ve_luminance(color) * 0.6), 0.0, 1.0);
    return vec4(color, 1.0);
}
