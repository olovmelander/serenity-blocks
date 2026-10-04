// GLSL counterpart of wgsl/lens-flare.wgsl: same ghost/halo/diffraction equations.
vec3 ve_flare_tap(sampler2D tex, vec2 uv) {
    return texture(tex, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}
vec3 ve_lens_ghosts(sampler2D tex, vec2 uv, float dispersal, float distortion) {
    vec2 flip = vec2(1.0) - uv;
    vec2 ghost_vec = (vec2(0.5) - flip) * dispersal;
    vec3 result = vec3(0.0);
    for (int i = 0; i < 5; i++) {
        vec2 offset = flip + ghost_vec * float(i);
        float d = length(vec2(0.5) - offset);
        float weight = pow(max(0.0, 1.0 - d * 1.6), 3.0);
        if (weight < 0.001) continue;
        vec2 dir = normalize(vec2(0.5) - offset + vec2(1e-5));
        vec2 ca = dir * distortion;
        result += vec3(ve_flare_tap(tex, offset + ca).r,
            ve_flare_tap(tex, offset).g, ve_flare_tap(tex, offset - ca).b) * weight;
    }
    return result;
}
vec3 ve_lens_halo(sampler2D tex, vec2 uv, float width) {
    vec2 flip = vec2(1.0) - uv;
    vec2 dir = normalize(vec2(0.5) - flip + vec2(1e-5));
    vec2 halo_uv = flip + dir * width;
    float d = length(vec2(0.5) - halo_uv);
    float weight = pow(max(0.0, 1.0 - d / max(width, 0.001)), 5.0);
    return ve_flare_tap(tex, halo_uv) * weight;
}
float ve_starburst(vec2 uv, vec2 star_uv, float aspect, float time) {
    vec2 d = (uv - star_uv) * vec2(aspect, 1.0);
    float angle = atan(d.y, d.x);
    float s = pow(abs(sin(angle * 3.0 + time * 0.05)), 32.0)
        + pow(abs(cos(angle * 3.0 - time * 0.03)), 32.0) * 0.6;
    return s * exp(-length(d) * 5.0);
}
